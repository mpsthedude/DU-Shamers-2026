const LIVE_API_ROOT = 'https://xvnkwtiydyrksucgiphi.supabase.co/functions/v1';
const LIVE_API_URL = `${LIVE_API_ROOT}/league-dashboard`;
const LIVE_MARKETS_URL = `${LIVE_API_ROOT}/draftkings-markets`;
const LIVE_PUBLISHABLE_KEY = 'sb_publishable_oTJVPjW_EdOokBZfTSJKaA_GuUwJjOF';

function liveHeaders() {
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
  if (!award) return;
  const winnerName = document.querySelector('#winnerName');
  const winnerScore = document.querySelector('#winnerScore');
  const label = document.querySelector('.weekly-winner .muted');
  const note = document.querySelector('.weekly-winner .tiny-note');

  if (label) label.textContent = `Week ${award.week} high scorer`;

  if (award.source_status === 'WINNER_IDENTIFIED' && award.fantasy_team_name) {
    if (winnerName) winnerName.textContent = award.fantasy_team_name;
    if (winnerScore) winnerScore.textContent = Number(award.score || 0).toFixed(2);
    if (note) note.textContent = `Live ESPN result synced to the league bank${award.identified_at ? ` on ${new Date(award.identified_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}` : ''}.`;
    return;
  }

  if (award.source_status === 'COMMISSIONER_RESOLUTION_REQUIRED') {
    if (winnerName) winnerName.textContent = 'Tie — commissioner resolution required';
    if (winnerScore) winnerScore.textContent = Number(award.score || 0).toFixed(2);
    if (note) note.textContent = 'The system detected a high-score tie. Commissioner handling remains intentionally manual.';
    return;
  }

  if (winnerName) winnerName.textContent = `Awaiting Week ${award.week || 1} results`;
  if (winnerScore) winnerScore.textContent = '0.00';
  if (note) note.textContent = 'The live backend is connected. Tuesday winner sync will populate this card after the scoring week is complete.';
}

function applyLiveLedger(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const tbody = document.querySelector('#ledgerRows');
  if (!tbody) return;
  tbody.innerHTML = rows.map((item) => {
    const amount = Number(item.amount_cents || 0) / 100;
    return `
      <tr>
        <td>${shortDate(item.occurred_at)}</td>
        <td>${item.description || item.transaction_type || 'Transaction'}</td>
        <td>${accountLabel(item.account)}</td>
        <td class="${amount >= 0 ? 'amount-credit' : 'amount-debit'}">${amount >= 0 ? '+' : '−'}${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(amount))}</td>
      </tr>`;
  }).join('');
}

function applyLiveStatus(data) {
  const badges = [...document.querySelectorAll('.topbar .status-pill')];
  const dataBadge = badges.find((el) => el.classList.contains('demo'));
  if (dataBadge) {
    dataBadge.classList.remove('demo');
    dataBadge.innerHTML = '<span class="dot"></span> Live league bank';
    dataBadge.style.color = 'var(--accent-2)';
  }

  const bonus = document.querySelector('#bonusBank');
  if (bonus) bonus.textContent = centsToMoney(data.bonus_bank_cents || 0);

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
  } catch (error) {
    console.warn('Live league bank unavailable; retaining dashboard fallback.', error);
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
    time: eventTime(event.starts_at),
    startsAt: event.starts_at,
    selections,
  };
}

async function fetchMarketLeague(league) {
  const response = await fetch(`${LIVE_MARKETS_URL}?league=${encodeURIComponent(league)}`, {
    method: 'GET',
    headers: liveHeaders(),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`draftkings-markets ${league} ${response.status}`);
  return response.json();
}

function markMarketsLive(count) {
  const bookNote = document.querySelector('.book-note span');
  if (bookNote) bookNote.textContent = `${count} upcoming NFL/college events loaded from live DraftKings pricing via SportsGameOdds. Other books remain context-only.`;

  const marketHeading = document.querySelector('.markets-panel .section-label');
  if (marketHeading) marketHeading.textContent = 'LIVE DRAFTKINGS BET BUILDER';
}

async function loadLiveDraftKingsMarkets() {
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

    if (!events.length) throw new Error('No live DraftKings markets returned');

    sampleEvents.splice(0, sampleEvents.length, ...events);
    state.legs = [];
    renderMarkets();
    renderSlip();
    markMarketsLive(events.length);
  } catch (error) {
    console.warn('Live DraftKings markets unavailable; retaining sample markets.', error);
    const bookNote = document.querySelector('.book-note span');
    if (bookNote) bookNote.textContent = 'Live DraftKings feed is temporarily unavailable. Sample markets are shown as a fallback.';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  loadLiveLeagueBank();
  loadLiveDraftKingsMarkets();
});
