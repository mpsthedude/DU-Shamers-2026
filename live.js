const LIVE_API_ROOT = 'https://xvnkwtiydyrksucgiphi.supabase.co/functions/v1';
const LIVE_API_URL = `${LIVE_API_ROOT}/league-dashboard`;
const LIVE_MARKETS_URL = `${LIVE_API_ROOT}/draftkings-markets`;
const LIVE_PUBLISHABLE_KEY = 'sb_publishable_oTJVPjW_EdOokBZfTSJKaA_GuUwJjOF';

function liveHeaders() {
  if (window.duShamersAuthHeaders) return window.duShamersAuthHeaders();
  return {
    apikey: LIVE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${LIVE_PUBLISHABLE_KEY}`,
  };
}

function centsToMoney(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
}

function shortDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(date);
}

function accountLabel(value) {
  const map = {
    GENERAL_POOL: 'General pool',
    PRIZE_RESERVE: 'Prize reserve',
    FUTURES_ALLOCATION: 'Futures',
    WEEKLY_ALLOCATION: 'Weekly program',
    BONUS_BANK: 'Bonus bank',
    CASH_PAYOUTS: 'Cash payouts',
  };
  return map[value] || value || '—';
}

function applyLiveAward(award) {
  const winnerName = document.querySelector('#winnerName');
  const winnerScore = document.querySelector('#winnerScore');
  const label = document.querySelector('.weekly-winner .muted');
  const note = document.querySelector('.weekly-winner .tiny-note');

  if (!award) {
    if (label) label.textContent = 'Weekly high scorer';
    if (winnerName) winnerName.textContent = 'Awaiting finalized results';
    if (winnerScore) winnerScore.textContent = '—';
    if (note) note.textContent = 'No weekly award has been recorded yet.';
    return;
  }

  if (award.award_basis === 'PREVIOUS_CHAMPION') {
    if (label) label.textContent = 'Opening week · Previous season champion';
    if (winnerName) winnerName.textContent = award.fantasy_team_name || 'David Belsky';
    if (winnerScore) winnerScore.textContent = '$100 wager';
    if (note) note.textContent = 'Champion’s opening selection: the full $100 goes on the ticket. No cash split.';
    return;
  }
  if (label) label.textContent = `Week ${award.week} ticket · prior week high scorer`;

  if (award.source_status === 'WINNER_IDENTIFIED' && award.fantasy_team_name) {
    if (winnerName) winnerName.textContent = award.fantasy_team_name;
    if (winnerScore) winnerScore.textContent = Number(award.score || 0).toFixed(2);
    if (note) note.textContent = `Live ESPN result synced to the league bank${award.identified_at ? ` on ${new Date(award.identified_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}` : ''}.`;
    return;
  }

  if (award.source_status === 'COMMISSIONER_RESOLUTION_REQUIRED') {
    if (winnerName) winnerName.textContent = 'Commissioner review required';
    if (winnerScore) winnerScore.textContent = Number(award.score || 0).toFixed(2);
    if (note) note.textContent = 'A high-score tie or corrected result needs review. Existing choices and financial records are preserved.';
    return;
  }

  if (winnerName) winnerName.textContent = `Awaiting Week ${award.week || 1} results`;
  if (winnerScore) winnerScore.textContent = '0.00';
  if (note) note.textContent = 'The live backend is connected. Tuesday winner sync will populate this card after the scoring week is complete.';
}

function applyLiveLedger(rows) {
  const tbody = document.querySelector('#ledgerRows');
  if (!tbody) return;
  tbody.replaceChildren();
  if (!Array.isArray(rows) || !rows.length) {
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent = 'No transactions recorded yet.';
    const row = document.createElement('tr');
    row.append(cell);
    tbody.append(row);
    return;
  }
  for (const item of rows) {
    const amount = Number(item.amount_cents || 0) / 100;
    const row = document.createElement('tr');
    const values = [shortDate(item.occurred_at), item.description || item.transaction_type || 'Transaction', accountLabel(item.account), `${amount >= 0 ? '+' : '−'}${centsToMoney(Math.abs(item.amount_cents || 0))}`];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index === 3) cell.className = amount >= 0 ? 'amount-credit' : 'amount-debit';
      row.append(cell);
    });
    tbody.append(row);
  }
}

function applyLiveStatus(data) {
  if (typeof renderFutures === 'function') renderFutures(data.bets, data.season);
  const dataBadge = document.querySelector('#bankDataStatus');
  if (dataBadge) {
    dataBadge.classList.remove('demo');
    dataBadge.innerHTML = '<span class="dot"></span> Live league bank';
    dataBadge.style.color = 'var(--accent-2)';
  }

  const bonus = document.querySelector('#bonusBank');
  if (bonus) bonus.textContent = centsToMoney(data.bonus_bank_cents || 0);

  for (const [id, key] of Object.entries({ weeklyRemaining: 'weekly_remaining_cents', futuresRemaining: 'futures_remaining_cents', cashPaid: 'cash_payouts_cents', weeklySpent: 'weekly_spent_cents' })) {
    const metric = document.getElementById(id);
    if (metric) metric.textContent = Number.isInteger(data.season?.[key]) ? centsToMoney(data.season[key]) : '—';
  }

  applyLiveAward(data.current_award);
  applyLiveLedger(data.ledger);
}

async function loadLiveLeagueBank() {
  try {
    const response = await fetch(LIVE_API_URL, {
      method: 'GET',
      headers: liveHeaders(),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`league-dashboard ${response.status}`);
    const data = await response.json();
    applyLiveStatus(data);
    if (typeof renderWeeklyTracker === 'function') renderWeeklyTracker(data.weekly_tracker);
    if (typeof renderLeagueStandings === 'function') renderLeagueStandings(data.standings);
    if (typeof renderWeeklyEditions === 'function') renderWeeklyEditions(data.editions);
  } catch (error) {
    if (typeof renderFutures === 'function') renderFutures(null);
    console.warn('Live league bank unavailable.', error);
    if (typeof renderWeeklyTracker === 'function') renderWeeklyTracker(null);
    if (typeof renderLeagueStandings === 'function') renderLeagueStandings(null);
    if (typeof renderWeeklyEditions === 'function') renderWeeklyEditions(null);
    const badge = document.querySelector('#bankDataStatus');
    if (badge) {
      badge.textContent = 'League bank unavailable';
      badge.classList.add('demo');
      badge.style.color = 'var(--warning)';
    }
    for (const id of ['bonusBank', 'weeklyRemaining', 'futuresRemaining', 'cashPaid', 'weeklySpent']) {
      const metric = document.getElementById(id);
      if (metric) metric.textContent = '—';
    }
    const rows = document.querySelector('#ledgerRows');
    if (rows) rows.innerHTML = '<tr><td colspan="4">Recorded transactions are unavailable. Reload to retry.</td></tr>';
    const winner = document.querySelector('#winnerName');
    const score = document.querySelector('#winnerScore');
    if (winner) winner.textContent = 'Winner data unavailable';
    if (score) score.textContent = '—';
    const note = document.querySelector('.weekly-winner .tiny-note');
    if (note) note.textContent = 'League data could not be refreshed. Winner and financial records are unavailable.';
  }
}

function toAmericanNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace('+', '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed !== 0 ? Math.trunc(parsed) : null;
}

function cleanNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function signedLine(value) {
  const number = cleanNumber(value);
  if (number === null) return '';
  return number > 0 ? `+${number}` : `${number}`;
}

function eventTime(iso) {
  if (!iso) return 'Start time unavailable';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Start time unavailable';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  }).format(date);
}

function normalizeDraftKingsSelection(event, offer) {
  const odds = toAmericanNumber(offer?.odds);
  if (!offer?.odd_id || odds === null) return null;

  const oddId = offer.odd_id;
  let market = null;
  let selection = null;

  if (oddId === 'points-home-game-ml-home') {
    market = 'Moneyline';
    selection = `${event.home?.name || 'Home'} ML`;
  } else if (oddId === 'points-away-game-ml-away') {
    market = 'Moneyline';
    selection = `${event.away?.name || 'Away'} ML`;
  } else if (oddId === 'points-home-game-sp-home') {
    market = 'Spread';
    selection = `${event.home?.name || 'Home'} ${signedLine(offer.spread)}`.trim();
  } else if (oddId === 'points-away-game-sp-away') {
    market = 'Spread';
    selection = `${event.away?.name || 'Away'} ${signedLine(offer.spread)}`.trim();
  } else if (oddId === 'points-all-game-ou-over') {
    market = 'Total';
    selection = `Over ${cleanNumber(offer.over_under) ?? ''}`.trim();
  } else if (oddId === 'points-all-game-ou-under') {
    market = 'Total';
    selection = `Under ${cleanNumber(offer.over_under) ?? ''}`.trim();
  }

  if (!market || !selection) return null;

  const movementParts = [];
  const openOdds = toAmericanNumber(offer.open_odds);
  if (openOdds !== null && openOdds !== odds) movementParts.push(`opened ${openOdds > 0 ? '+' : ''}${openOdds}`);
  const currentLine = offer.spread ?? offer.over_under;
  const openLine = offer.open_spread ?? offer.open_over_under;
  if (cleanNumber(openLine) !== null && cleanNumber(currentLine) !== null && Number(openLine) !== Number(currentLine)) {
    movementParts.push(`line opened ${openLine}`);
  }

  return {
    id: `${event.event_id}:${oddId}`,
    market,
    selection,
    odds,
    rating: 'neutral',
    note: movementParts.length
      ? `Live DraftKings market. ${movementParts.join('; ')}. Full intelligence analysis will evaluate this leg before submission.`
      : 'Live DraftKings market from SportsGameOdds. Full intelligence analysis will evaluate this leg before submission.',
    providerOddId: oddId,
    providerEventId: event.event_id,
    eventStartAt: event.starts_at,
    fairOdds: offer.fair_odds ?? null,
    line: cleanNumber(currentLine),
  };
}

function normalizeDraftKingsEvent(event) {
  const selections = (Array.isArray(event?.odds) ? event.odds : [])
    .map((offer) => normalizeDraftKingsSelection(event, offer))
    .filter(Boolean);

  if (!event?.event_id || !selections.length) return null;
  return {
    id: event.event_id,
    sport: event.league === 'NCAAF' ? 'NCAAF' : 'NFL',
    name: `${event.away?.name || 'Away'} @ ${event.home?.name || 'Home'}`,
    searchNames: `${event.away?.short || ''} ${event.home?.short || ''}`,
    time: eventTime(event.starts_at),
    startsAt: event.starts_at,
    selections,
  };
}

async function fetchMarketLeague(league) {
  // Wait for persisted sign-in restoration before attempting a cache miss.
  const session = typeof authClient !== 'undefined' ? await authClient.auth.getSession().catch(() => null) : null;
  const headers = liveHeaders();
  if (session?.data?.session?.access_token) headers.Authorization = `Bearer ${session.data.session.access_token}`;
  const response = await fetch(`${LIVE_MARKETS_URL}?league=${encodeURIComponent(league)}`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'provider_request_unavailable');
  }
  return response.json();
}

function markMarketsLive(count, observed, stale = false) {
  const bookNote = document.querySelector('.book-note span');
  if (bookNote) bookNote.textContent = `${count} upcoming NFL/college events from the automatic daily DraftKings update${observed ? ' · observed ' + new Date(observed).toLocaleString() : ''}. ${stale ? 'Daily update delayed; showing older prices. ' : ''}Prices are checked again before submission.`;

  const marketHeading = document.querySelector('.markets-panel .section-label');
  if (marketHeading) marketHeading.textContent = 'DAILY DRAFTKINGS BET BUILDER';
}

async function loadLiveDraftKingsMarkets({preserveTicket = false} = {}) {
  try {
    const results = await Promise.allSettled([
      fetchMarketLeague('NFL'),
      fetchMarketLeague('NCAAF'),
    ]);

    const events = results
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => Array.isArray(result.value?.events) ? result.value.events : [])
      .map(normalizeDraftKingsEvent)
      .filter(Boolean)
      .sort((a, b) => new Date(a.startsAt || 0) - new Date(b.startsAt || 0));

    ['NFL','NCAAF'].forEach((league,index) => {
      state.marketCoverage[league] = results[index].status === 'fulfilled' ? results[index].value.coverage : {complete:false};
    });

    if (!events.length) throw new Error(results.find(r => r.status === 'rejected')?.reason?.message || 'no_upcoming_markets');

    sampleEvents.splice(0, sampleEvents.length, ...events);
    if (!preserveTicket) state.legs = [];
    renderMarkets();
    renderSlip();
    const observations = results.filter(r => r.status === 'fulfilled').map(r => r.value?.provider_cache?.oldest_observed_at).filter(Boolean).sort();
    markMarketsLive(events.length, observations[0], results.some(r => r.status === 'fulfilled' && r.value?.stale));
  } catch (error) {
    console.warn('DraftKings snapshots unavailable.', error);
    sampleEvents.splice(0, sampleEvents.length);
    if (!preserveTicket) state.legs = [];
    renderMarkets();
    renderSlip();
    const bookNote = document.querySelector('.book-note span');
    if (bookNote) bookNote.textContent = marketLoadError(error.message);
  }
}

function marketLoadError(code) {
  return ({
    daily_snapshot_unavailable: 'The first automatic daily game update is pending, or saved data is unavailable.',
    integrations_disabled: 'The overall integration switch is off. Enable overall reservations in Commissioner Tools; subscription-covered calls can use a $0 budget.',
    paid_requests_disabled: 'SportsGameOdds refreshes are paused. Enable provider refreshes in Commissioner Tools.',
    fresh_provider_request_not_authorized: 'No shared prices are cached yet. The commissioner must sign in and select Refresh market snapshots.',
    provider_usage_refresh_required: 'Provider usage needs checking. Select Check provider usage in Commissioner Tools, then refresh market snapshots.',
    provider_budget_exhausted: 'The provider request or spending limit has been reached.',
    integration_budget_exhausted: 'The overall integration budget has been reached.',
    no_upcoming_markets: 'No upcoming DraftKings games with available odds were returned for this date window.',
  })[code] || 'DraftKings prices could not be loaded. Try Refresh market snapshots in Commissioner Tools; if it continues, the provider or its limits need checking.';
}

window.addEventListener('DOMContentLoaded', () => {
  loadLiveLeagueBank();
  loadLiveDraftKingsMarkets();
  // Only reads the shared dashboard snapshot; never dispatches provider refreshes.
  setInterval(()=>{if(document.visibilityState==='visible')loadLiveLeagueBank();},180000);
  setInterval(()=>{if(document.visibilityState==='visible')loadLiveDraftKingsMarkets({preserveTicket:true});},300000);
});
