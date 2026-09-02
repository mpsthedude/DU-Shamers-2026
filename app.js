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

const sampleFutures = [
  { team: 'Denver', market: 'AFC Champion', stake: 100, placed: 850, current: 650, points: '5,44 25,40 45,37 65,31 85,27 105,20 125,16' },
  { team: 'LSU', market: 'College Football Champion', stake: 100, placed: 1200, current: 1000, points: '5,42 25,39 45,41 65,33 85,29 105,26 125,22' },
  { team: 'Buffalo', market: 'Super Bowl Champion', stake: 100, placed: 900, current: 950, points: '5,28 25,25 45,27 65,29 85,32 105,31 125,35' },
  { team: 'Georgia', market: 'College Football Champion', stake: 100, placed: 700, current: 550, points: '5,45 25,43 45,36 65,34 85,28 105,24 125,18' },
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
  sport: 'ALL',
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
  const visible = sampleEvents.filter((event) => state.sport === 'ALL' || event.sport === state.sport);
  $('#marketList').innerHTML = visible.map((event) => `
    <article class="event-card">
      <div class="event-head">
        <div>
          <strong>${event.name}</strong>
          <div class="event-meta">${event.time} · Sample DraftKings lines</div>
        </div>
        <span class="sport-chip">${event.sport === 'NCAAF' ? 'COLLEGE' : event.sport}</span>
      </div>
      <div class="market-options">
        ${event.selections.map((selection) => {
          const isSelected = state.legs.some((leg) => leg.id === selection.id);
          return `
            <button class="market-option ${isSelected ? 'selected' : ''}" data-event="${event.id}" data-selection="${selection.id}">
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
        <small>${leg.market} · DraftKings sample line</small>
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

function renderFutures() {
  $('#futureGrid').innerHTML = sampleFutures.map((future) => {
    const placedDecimal = americanToDecimal(future.placed);
    const potential = future.stake * placedDecimal;
    const improved = future.current < future.placed;
    const movement = improved ? 'Market moved in favor' : future.current > future.placed ? 'Market moved against' : 'Market unchanged';
    return `
      <article class="future-card">
        <div class="section-label">SAMPLE POSITION</div>
        <h3>${future.team}</h3>
        <div class="future-market">${future.market}</div>
        <div class="future-values">
          <div><span>Ticket odds</span><strong>${formatOdds(future.placed)}</strong></div>
          <div><span>Sample current</span><strong>${formatOdds(future.current)}</strong></div>
          <div><span>Stake</span><strong>${money(future.stake)}</strong></div>
          <div><span>Potential return</span><strong>${money(potential)}</strong></div>
        </div>
        <svg class="sparkline" viewBox="0 0 130 55" role="img" aria-label="Sample odds movement chart"><polyline points="${future.points}" /></svg>
        <div class="line-move">${movement}</div>
      </article>`;
  }).join('');
}

function renderLedger() {
  $('#ledgerRows').innerHTML = ledger.map((item) => `
    <tr>
      <td>${item.date}</td>
      <td>${item.label}</td>
      <td>${item.account}</td>
      <td class="${item.amount >= 0 ? 'amount-credit' : 'amount-debit'}">${item.amount >= 0 ? '+' : '−'}${money(Math.abs(item.amount))}</td>
    </tr>
  `).join('');
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
  $$('.choice-button').forEach((button) => button.addEventListener('click', () => {
    state.choice = button.dataset.choice;
    persist();
    renderChoice();
    showToast(state.choice === 'ride' ? '$100 Let It Ride selected.' : '$50 cash + $50 wager selected.');
  }));

  $$('.tab').forEach((tab) => tab.addEventListener('click', () => {
    state.sport = tab.dataset.sport;
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
