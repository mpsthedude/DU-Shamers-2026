const league = {
  totalPool: 3600,
  prizeReserve: 1800,
  futuresBudget: 400,
  weeklyBudget: 1400,
  weeks: 14,
};

const sampleEvents = [
  {
    id: 'nfl-den-lac',
    sport: 'NFL',
    name: 'Denver @ Los Angeles',
    time: 'Sample Sunday · 4:25 PM ET',
    selections: [
      { id: 'den-plus', market: 'Spread', selection: 'Denver +2.5', odds: -110, rating: 'strong', note: 'Sample signal: DraftKings number is slightly better than the demo consensus.' },
      { id: 'den-ml', market: 'Moneyline', selection: 'Denver ML', odds: 125, rating: 'neutral', note: 'Sample signal: plus-money exposure with neutral market context.' },
      { id: 'den-over', market: 'Total', selection: 'Over 46.5', odds: -105, rating: 'neutral', note: 'Sample signal: total has been stable in the demo market.' },
    ],
  },
  {
    id: 'nfl-buf-bal',
    sport: 'NFL',
    name: 'Buffalo @ Baltimore',
    time: 'Sample Sunday · 8:20 PM ET',
    selections: [
      { id: 'buf-plus', market: 'Spread', selection: 'Buffalo +3.5', odds: -108, rating: 'strong', note: 'Sample signal: hook above a key number improves the profile.' },
      { id: 'bal-ml', market: 'Moneyline', selection: 'Baltimore ML', odds: -165, rating: 'neutral', note: 'Sample signal: higher implied probability but reduced payout contribution.' },
      { id: 'buf-over', market: 'Total', selection: 'Over 49.5', odds: -112, rating: 'weak', note: 'Sample risk: demo market movement is against the over.' },
    ],
  },
  {
    id: 'cfb-lsu-fla',
    sport: 'NCAAF',
    name: 'LSU @ Florida',
    time: 'Sample Saturday · 7:30 PM ET',
    selections: [
      { id: 'lsu-spread', market: 'Spread', selection: 'LSU -6.5', odds: -110, rating: 'neutral', note: 'Sample signal: spread is close to demo consensus.' },
      { id: 'lsu-ml', market: 'Moneyline', selection: 'LSU ML', odds: -245, rating: 'strong', note: 'Sample signal: lower-return leg with a stronger demo market profile.' },
      { id: 'lsu-over', market: 'Total', selection: 'Over 55.5', odds: -105, rating: 'weak', note: 'Sample risk: weather/pace flags would be surfaced here by the live analyzer.' },
    ],
  },
  {
    id: 'cfb-ala-uga',
    sport: 'NCAAF',
    name: 'Alabama @ Georgia',
    time: 'Sample Saturday · 3:30 PM ET',
    selections: [
      { id: 'uga-spread', market: 'Spread', selection: 'Georgia -3', odds: -110, rating: 'neutral', note: 'Sample signal: price is aligned with the demo market.' },
      { id: 'bama-ml', market: 'Moneyline', selection: 'Alabama ML', odds: 145, rating: 'weak', note: 'Sample risk: demo price has moved away from this side.' },
      { id: 'ala-under', market: 'Total', selection: 'Under 51.5', odds: -110, rating: 'strong', note: 'Sample signal: demo total has moved downward while this number remains available.' },
    ],
  },
];

const ledger = [
  { date: 'Sep 1', label: 'League buy-ins funded', account: 'General pool', amount: 3600 },
  { date: 'Sep 1', label: 'Prize reserve earmarked', account: 'Prize reserve', amount: -1800 },
  { date: 'Sep 1', label: 'Season futures allocation', account: 'Futures', amount: -400 },
  { date: 'Sep 1', label: 'Weekly high-score allocation', account: 'Weekly program', amount: -1400 },
];

const saved = JSON.parse(localStorage.getItem('duShamersDemoState') || '{}');
const state = {
  choice: saved.choice || null,
  legs: [],
  sport: 'NFL',
  marketDisplayLimit: 20,
  marketCoverage: {},
  submissions: Array.isArray(saved.submissions) ? saved.submissions : [],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function persist() {
  localStorage.setItem('duShamersDemoState', JSON.stringify({
    choice: state.choice,
    submissions: state.submissions,
  }));
}

function money(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function americanToDecimal(odds) {
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

function decimalToAmerican(decimal) {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

function formatOdds(odds) {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function combinedDecimal() {
  return state.legs.reduce((product, leg) => product * americanToDecimal(leg.odds), 1);
}

function selectedStake() {
  if (state.choice === 'split') return 50;
  if (state.choice === 'ride') return 100;
  return 0;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2400);
}

function renderChoice() {
  $$('.choice-button').forEach((button) => {
    button.classList.toggle('selected', button.dataset.choice === state.choice);
  });
  const stake = selectedStake();
  const badge = $('#stakeBadge');
  if (!stake) {
    badge.textContent = 'Choose payout';
    badge.classList.remove('ready');
  } else {
    badge.textContent = `${money(stake)} wager`;
    badge.classList.add('ready');
  }
  renderSlip();
}

function renderMarkets() {
  const search = ($('#gameSearch')?.value || '').trim().toLowerCase();
  const weekOnly = ($('#gameWindow')?.value || 'week') === 'week';
  const now = Date.now();
  const upcoming = sampleEvents.filter(event => event.sport === state.sport && (!event.startsAt || new Date(event.startsAt).getTime() > now));
  const matching = upcoming.filter(event =>
    (!weekOnly || !event.startsAt || new Date(event.startsAt).getTime() < now + 7 * 86400000) &&
    `${event.name} ${event.sport} ${event.searchNames || ''} ${event.selections.map(s => `${s.market} ${s.selection}`).join(' ')}`.toLowerCase().includes(search))
    .sort((a,b) => Date.parse(a.startsAt || 0)-Date.parse(b.startsAt || 0));
  const visible = matching.slice(0, state.marketDisplayLimit);
  const count = $('#gameCount');
  const coverage = state.marketCoverage[state.sport];
  if (count) count.textContent = `Showing ${visible.length} of ${matching.length} matching games · ${upcoming.length} loaded · ${weekOnly ? 'next 7 days' : 'all loaded dates'}`;
  const coverageNote = $('#gameCoverage');
  if (coverageNote) coverageNote.textContent = coverage?.complete === true
    ? 'All feed pages loaded for this date window. Search checks every loaded game.'
    : 'Schedule may be incomplete. Search checks loaded games only; a commissioner refresh is needed for missing pages.';
  const more = $('#showMoreGames');
  if (more) { more.hidden = matching.length <= visible.length; more.textContent = `Show more games (${matching.length-visible.length} remaining)`; }
  if (!visible.length) {
    $('#marketList').innerHTML = '<p class="empty-state">'+(upcoming.length ? 'No games match. Try another team, league or date filter.' : 'No upcoming DraftKings games are loaded yet.')+'</p>';
    return;
  }
  $('#marketList').innerHTML = visible.map((event) => `
    <article class="event-card">
      <div class="event-head">
        <div>
          <strong>${event.name}</strong>
          <div class="event-meta">${event.time} · ${event.selections.some((selection) => selection.providerOddId) ? 'DraftKings market snapshot' : 'Sample DraftKings lines'}</div>
        </div>
        <span class="sport-chip">${event.sport === 'NCAAF' ? 'COLLEGE' : event.sport}</span>
      </div>
      <div class="market-options">
        ${event.selections.map((selection) => {
          const isSelected = state.legs.some((leg) => leg.id === selection.id);
          const conflict = !isSelected && ticketConflict([...state.legs, {...selection,eventId:event.id}]);
          return `
            <button class="market-option ${isSelected ? 'selected' : ''}" title="${conflict || ''}" ${conflict ? 'disabled' : ''} data-event="${event.id}" data-selection="${selection.id}">
              <span>${selection.market}</span>
              <strong>${selection.selection}</strong>
              <small>DK ${formatOdds(selection.odds)}</small>
            </button>`;
        }).join('')}
      </div>
    </article>
  `).join('');

  $$('.market-option').forEach((button) => button.addEventListener('click', () => toggleLeg(button.dataset.event, button.dataset.selection)));
}

function toggleLeg(eventId, selectionId) {
  const existing = state.legs.findIndex((leg) => leg.id === selectionId);
  if (existing >= 0) {
    state.legs.splice(existing, 1);
  } else {
    const event = sampleEvents.find((item) => item.id === eventId);
    const selection = event.selections.find((item) => item.id === selectionId);
    const conflict = ticketConflict([...state.legs,{...selection,eventId:event.id}]);
    if (conflict) return showToast(conflict);
    state.legs.push({ ...selection, eventId: event.id, eventName: event.name, sport: event.sport, time: event.time });
  }
  renderMarkets();
  renderSlip();
}

function renderSlip() {
  const hasLegs = state.legs.length > 0;
  $('#slipEmpty').classList.toggle('hidden', hasLegs);
  $('#slipTotals').classList.toggle('hidden', !hasLegs);
  $('#slipLegs').innerHTML = state.legs.map((leg) => `
    <div class="slip-leg">
      <div>
        <strong>${leg.eventName}</strong>
        <span>${leg.selection} · ${formatOdds(leg.odds)}</span>
        <small>${leg.market} · ${leg.providerOddId ? 'DraftKings market snapshot' : 'DraftKings sample line'}</small>
      </div>
      <button class="remove-leg" data-remove="${leg.id}" aria-label="Remove ${leg.selection}">×</button>
    </div>
  `).join('');

  $$('[data-remove]').forEach((button) => button.addEventListener('click', () => {
    state.legs = state.legs.filter((leg) => leg.id !== button.dataset.remove);
    renderMarkets();
    renderSlip();
  }));

  if (!hasLegs) return;

  const decimal = combinedDecimal();
  const combinedAmerican = decimalToAmerican(decimal);
  const probability = 100 / decimal;
  const stake = selectedStake();
  $('#parlayOdds').textContent = state.legs.length === 1 ? formatOdds(state.legs[0].odds) : formatOdds(combinedAmerican);
  $('#impliedProbability').textContent = `${probability.toFixed(1)}%`;
  $('#stakeAmount').textContent = stake ? money(stake) : 'Choose payout';
  $('#potentialReturn').textContent = stake ? money(stake * decimal) : '—';

  const eventIds = state.legs.map((leg) => leg.eventId);
  const hasSameGame = new Set(eventIds).size !== eventIds.length;
  $('#sgpWarning').classList.toggle('hidden', !hasSameGame);
  $('#potentialReturn').previousElementSibling.textContent = hasSameGame ? 'Unadjusted estimated return' : 'Estimated return';
  $('#parlayOdds').previousElementSibling.textContent = hasSameGame ? 'Unadjusted estimated odds' : 'Estimated odds';
  $('#impliedProbability').textContent = hasSameGame ? 'Not available for same-game combinations' : `${probability.toFixed(1)}%`;
}

function analyzeTicket() {
  if (!state.legs.length) return showToast('Add at least one selection first.');
  if (!selectedStake()) return showToast('Choose the $50/$50 or Let It Ride option first.');

  const decimal = combinedDecimal();
  const eventIds = state.legs.map((leg) => leg.eventId);
  const hasSameGame = new Set(eventIds).size !== eventIds.length;
  const ratingCounts = state.legs.reduce((acc, leg) => {
    acc[leg.rating] = (acc[leg.rating] || 0) + 1;
    return acc;
  }, {});
  const overall = ratingCounts.weak ? 'Mixed' : ratingCounts.strong >= Math.ceil(state.legs.length / 2) ? 'Positive' : 'Neutral';

  $('#analysisSummary').innerHTML = `
    <div class="analysis-metric"><span>Ticket profile</span><strong>${overall}</strong></div>
    <div class="analysis-metric"><span>Legs</span><strong>${state.legs.length}</strong></div>
    <div class="analysis-metric"><span>DK implied</span><strong>${(100 / decimal).toFixed(1)}%</strong></div>
    <div class="analysis-metric"><span>Correlation</span><strong>${hasSameGame ? 'Review SGP' : 'No demo flag'}</strong></div>
  `;

  $('#analysisLegs').innerHTML = state.legs.map((leg) => `
    <article class="analysis-leg">
      <div>
        <strong>${leg.selection} <span class="muted">${formatOdds(leg.odds)}</span></strong>
        <p>${leg.note}</p>
      </div>
      <span class="rating ${leg.rating}">${leg.rating.toUpperCase()}</span>
    </article>
  `).join('');

  $('#analyzer').classList.remove('hidden');
  $('#analyzer').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function submitTicket() {
  const stake = selectedStake();
  if (!stake) return showToast('Choose the weekly payout option first.');
  if (!state.legs.length) return showToast('Build a ticket before submitting.');

  const decimal = combinedDecimal();
  const combinedOdds = state.legs.length === 1 ? state.legs[0].odds : decimalToAmerican(decimal);
  const submission = {
    id: `demo-${Date.now()}`,
    createdAt: new Date().toISOString(),
    week: 1,
    owner: 'Demo weekly winner',
    choice: state.choice,
    stake,
    combinedOdds,
    potentialReturn: stake * decimal,
    legs: state.legs.map((leg) => ({ selection: leg.selection, odds: leg.odds, eventName: leg.eventName })),
    status: 'AWAITING_COMMISSIONER_PLACEMENT',
  };
  state.submissions.unshift(submission);
  persist();
  renderQueue();
  showToast('Ticket submitted to the commissioner queue.');
  $('#commissioner').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderFutures(bets, season = {}) {
  const grid = document.getElementById('futureGrid');
  const status = document.getElementById('futuresStatus');
  const summary = document.getElementById('futuresSummary');
  if (!grid || !status || !summary) return;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dollars = (value) => Number.isInteger(value) ? new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(value / 100) : '—';
  if (!Array.isArray(bets)) {
    status.textContent = bets === undefined ? 'Loading positions' : 'Positions unavailable';
    summary.textContent = '';
    grid.innerHTML = '<p>' + (bets === undefined ? 'Loading recorded tickets…' : 'Recorded tickets could not be refreshed. Reload to retry.') + '</p>';
    return;
  }
  const positions = bets.filter((bet) => bet.category === 'FUTURE');
  status.textContent = `${positions.filter((bet) => bet.status === 'OPEN').length} open · ${positions.length} total`;
  const staked = positions.reduce((sum, bet) => sum + bet.stake_cents, 0);
  summary.textContent = `${dollars(staked)} staked · ${dollars(season.futures_budget_cents)} season budget · ${dollars(season.futures_remaining_cents)} remaining`;
  grid.innerHTML = positions.length ? positions.map((bet) => {
    const legs = bet.bet_legs || [];
    const title = bet.description || legs.map((leg) => leg.selection).join(' + ') || 'Recorded futures ticket';
    const market = bet.market_label || legs.map((leg) => leg.market_name).join(' + ');
    const settled = ['WON', 'LOST', 'PUSHED', 'VOID'].includes(bet.status);
    return `<article class="future-card">
      <div class="section-label">DRAFTKINGS · ${escape(bet.status)}</div>
      <h3>${escape(title)}</h3>
      <div class="future-market">${escape(market)}</div>
      <div class="future-values">
        <div><span>Ticket odds</span><strong>${escape(formatOdds(bet.placed_american_odds))}</strong></div>
        <div><span>Stake</span><strong>${dollars(bet.stake_cents)}</strong></div>
        <div><span>${settled ? 'Official return' : 'Return if won'}</span><strong>${dollars(settled ? bet.settlement_return_cents : bet.potential_return_cents)}</strong></div>
      </div>
      ${renderFuturesTrend(bet)}
    </article>`;
  }).join('') : '<p>No season-long tickets have been recorded yet.</p>';
}

function renderFuturesTrend(bet) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const probability = (n) => n > 0 ? 100 / (n + 100) : -n / (-n + 100);
  const pct = (p) => (p * 100).toFixed(1) + '%';
  const original = probability(bet.placed_american_odds);
  const history = (bet.futures_history || []).filter(h => Number.isInteger(h.american_odds) && Math.abs(h.american_odds) >= 100).sort((a,b) => Date.parse(a.snapshot_date || a.observed_at)-Date.parse(b.snapshot_date || b.observed_at));
  const latest = history.at(-1);
  if (!latest) return `<div class="future-trend"><strong>Ticket implied chance ${pct(original)}</strong><p>${bet.futures_covered === false ? 'This exact futures market is not available from the connected feed. Automatic comparison unavailable.' : bet.futures_history === null ? 'Market history temporarily unavailable.' : 'Awaiting the first automatic DraftKings price check.'}</p></div>`;
  const current = probability(latest.american_odds), change = (current-original)*100;
  const direction = Math.abs(change)<0.00001 ? 'Unchanged' : change>0 ? 'Improved' : 'Declined';
  const stale = Date.now()-Date.parse(latest.observed_at)>25*3600000;
  const pending = stale;
  const values = [original,...history.map(h=>probability(h.american_odds))];
  const low = Math.max(0,Math.min(...values)-0.005), high = Math.max(...values)+0.005;
  const coordinates = values.map((v,i)=>[8+i*184/(values.length-1),58-(v-low)/(high-low)*44]);
  const points = coordinates.map(p=>p.join(',')).join(' ');
  const dots = coordinates.map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="3"><title>${esc(i===0?'Ticket: '+pct(original):(history[i-1].snapshot_date || 'Saved check')+': '+formatOdds(history[i-1].american_odds)+' / '+pct(values[i]))}</title></circle>`).join('');
  return `<div class="future-trend">
    <strong class="future-move ${direction.toLowerCase()}">${stale || pending ? 'Last observed: ' : ''}${direction} · ${change>0?'+':''}${change.toFixed(2)} percentage points</strong>
    <p>Ticket ${pct(original)} → Latest ${pct(current)}<br>Latest DraftKings odds <b>${esc(formatOdds(latest.american_odds))}</b></p>
    <svg class="future-chart" viewBox="0 0 200 74" role="img" aria-label="Market-implied chance: ticket ${pct(original)}, latest ${pct(current)}"><text x="8" y="10">${pct(high)}</text><polyline points="${points}"/>${dots}<text x="8" y="72">Ticket</text><text x="135" y="72">Latest check</text></svg>
    <p class="tiny-note">${bet.status!=='OPEN'?'Final saved market history. ':''}${stale?'Older price · ':''}${pending?'Daily update pending · ':''}${bet.futures_automatic?'Automatic daily check':'Automatic checks paused'}<br>Price as of ${esc(new Date(latest.observed_at).toLocaleString('en-US'))}</p>
    <details><summary>Price history</summary><table><thead><tr><th>Check</th><th>DK odds</th><th>Implied</th></tr></thead><tbody><tr><td>Ticket</td><td>${esc(formatOdds(bet.placed_american_odds))}</td><td>${pct(original)}</td></tr>${history.map(h=>`<tr><td>${esc(h.snapshot_date || new Date(h.observed_at).toLocaleDateString('en-US'))}</td><td>${esc(formatOdds(h.american_odds))}</td><td>${pct(probability(h.american_odds))}</td></tr>`).join('')}</tbody></table></details>
  </div>`;
}

function renderLedger() {
  $('#ledgerRows').innerHTML = '<tr><td colspan="4">Loading recorded transactions…</td></tr>';
}

function renderQueue() {
  $('#queueCount').textContent = state.submissions.length;
  if (!state.submissions.length) {
    $('#commissionerQueue').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✓</div>
        <p>No proposed tickets are awaiting manual DraftKings placement.</p>
      </div>`;
    return;
  }

  $('#commissionerQueue').innerHTML = state.submissions.map((submission) => `
    <article class="queue-item">
      <strong>Week ${submission.week} · ${submission.legs.length}-leg ${submission.legs.length > 1 ? 'parlay' : 'bet'} · ${formatOdds(submission.combinedOdds)}</strong>
      <span>${money(submission.stake)} stake · estimated return ${money(submission.potentialReturn)}</span>
      <span>${submission.legs.map((leg) => leg.selection).join(' • ')}</span>
      <span class="queue-status">Awaiting commissioner placement in DraftKings</span>
    </article>
  `).join('');
}

function wireEvents() {
  for (const [id, eventName] of [['gameSearch', 'input'], ['gameWindow', 'change']]) {
    $('#'+id)?.addEventListener(eventName, () => { state.marketDisplayLimit = 20; renderMarkets(); $('#marketList').scrollTop = 0; });
  }
  $('#showMoreGames')?.addEventListener('click', () => { state.marketDisplayLimit += 20; renderMarkets(); });
  $$('.choice-button').forEach((button) => button.addEventListener('click', () => {
    state.choice = button.dataset.choice;
    persist();
    renderChoice();
    showToast(state.choice === 'ride' ? '$100 Let It Ride selected.' : '$50 cash + $50 wager selected.');
  }));

  $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
    state.sport = tab.dataset.sport;
    state.marketDisplayLimit = 20;
    $$('.tab').forEach((item) => item.classList.toggle('active', item === tab));
    renderMarkets();
  }));

  $$('[data-scroll]').forEach((button) => button.addEventListener('click', () => {
    document.getElementById(button.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' });
  }));

  $('#analyzeButton').addEventListener('click', analyzeTicket);
  $('#submitButton').addEventListener('click', submitTicket);
}

function init() {
  renderChoice();
  renderMarkets();
  renderFutures();
  renderLedger();
  renderQueue();
  wireEvents();

  const allocated = league.prizeReserve + league.futuresBudget + league.weeklyBudget;
  if (allocated !== league.totalPool) {
    console.warn('League allocations do not reconcile to the starting pool.');
  }
}

init();
