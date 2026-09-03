const LIVE_PROPS_URL = `${LIVE_API_ROOT}/draftkings-event-props`;
const propsCache = new Map();
let activePropsEventId = null;
let activePropsData = null;

function propCategory(statId) {
  const stat = String(statId || '').toLowerCase();
  if (stat.startsWith('passing')) return 'Passing';
  if (stat.startsWith('rushing')) return 'Rushing';
  if (stat.startsWith('receiving')) return 'Receiving';
  if (stat.includes('touchdown')) return 'Touchdowns';
  return 'Other';
}

function prettyStat(statId) {
  const map = {
    passing_yards: 'Passing Yards',
    passing_touchdowns: 'Passing TDs',
    rushing_yards: 'Rushing Yards',
    receiving_yards: 'Receiving Yards',
    receiving_receptions: 'Receptions',
    'rushing+receiving_yards': 'Rush + Rec Yards',
    touchdowns: 'Touchdowns',
    firstTouchdown: 'First Touchdown',
  };
  if (map[statId]) return map[statId];
  return String(statId || 'Player Prop')
    .replace(/[+_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function cap(value) {
  const text = String(value || '').toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function propSelectionLabel(prop) {
  const stat = prettyStat(prop.stat_id);
  const side = cap(prop.side);
  const hasLine = prop.line !== null && prop.line !== undefined && prop.line !== '';
  return `${prop.player_name} ${stat}${side ? ` ${side}` : ''}${hasLine ? ` ${prop.line}` : ''}`.trim();
}

function normalizePropLeg(event, prop) {
  const odds = toAmericanNumber(prop?.odds);
  if (!prop?.odd_id || odds === null) return null;
  return {
    id: `${event.id}:${prop.odd_id}`,
    market: `Player Prop · ${prettyStat(prop.stat_id)}`,
    selection: propSelectionLabel(prop),
    odds,
    rating: 'neutral',
    note: 'Live full-game DraftKings player prop via SportsGameOdds. The intelligence analyzer will evaluate market context, news, injuries, and movement before submission.',
    providerOddId: prop.odd_id,
    providerEventId: event.id,
    eventStartAt: event.startsAt,
    fairOdds: prop.fair_odds ?? null,
    playerId: prop.player_id ?? null,
    playerName: prop.player_name ?? null,
    statId: prop.stat_id ?? null,
    betType: prop.bet_type ?? null,
    side: prop.side ?? null,
    line: prop.line ?? null,
  };
}

function ensurePropsExplorer() {
  let explorer = document.querySelector('#playerPropsExplorer');
  if (explorer) return explorer;
  const panel = document.querySelector('.markets-panel');
  const marketList = document.querySelector('#marketList');
  if (!panel || !marketList) return null;

  explorer = document.createElement('section');
  explorer.id = 'playerPropsExplorer';
  explorer.className = 'props-explorer hidden';
  explorer.innerHTML = `
    <div class="props-head">
      <div>
        <div class="section-label">LIVE DRAFTKINGS PLAYER PROPS</div>
        <h3 id="propsTitle">Player props</h3>
        <p id="propsMeta">Full-game NFL markets only</p>
      </div>
      <button class="props-close" id="propsClose" aria-label="Close player props">×</button>
    </div>
    <div class="props-controls">
      <input id="propSearch" type="search" placeholder="Search player name…" autocomplete="off" />
      <select id="propCategory" aria-label="Filter prop category">
        <option value="ALL">All props</option>
        <option value="Passing">Passing</option>
        <option value="Rushing">Rushing</option>
        <option value="Receiving">Receiving</option>
        <option value="Touchdowns">Touchdowns</option>
        <option value="Other">Other</option>
      </select>
    </div>
    <div id="propsResults" class="props-results"><div class="props-loading">Select an NFL game to load player props.</div></div>
  `;
  panel.insertBefore(explorer, marketList);

  explorer.querySelector('#propsClose')?.addEventListener('click', () => {
    explorer.classList.add('hidden');
    activePropsEventId = null;
  });
  explorer.querySelector('#propSearch')?.addEventListener('input', renderPropResults);
  explorer.querySelector('#propCategory')?.addEventListener('change', renderPropResults);
  return explorer;
}

function enhanceEventPropButtons() {
  document.querySelectorAll('.event-card').forEach((card) => {
    if (card.querySelector('.props-open-button')) return;
    const firstMarket = card.querySelector('.market-option[data-event]');
    const eventId = firstMarket?.dataset?.event;
    const event = sampleEvents.find((item) => item.id === eventId);
    if (!event || event.sport !== 'NFL') return;

    const tools = document.createElement('div');
    tools.className = 'event-tools';
    const cached = propsCache.get(event.id);
    tools.innerHTML = `<button class="props-open-button" type="button">PLAYER PROPS${cached ? ` · ${cached.props?.length || 0}` : ''}</button>`;
    card.appendChild(tools);
    tools.querySelector('button')?.addEventListener('click', () => openPlayerProps(event.id));
  });
}

function renderPropResults() {
  const results = document.querySelector('#propsResults');
  if (!results || !activePropsData || !activePropsEventId) return;
  const event = sampleEvents.find((item) => item.id === activePropsEventId);
  if (!event) return;

  const query = String(document.querySelector('#propSearch')?.value || '').trim().toLowerCase();
  const category = document.querySelector('#propCategory')?.value || 'ALL';
  const props = (Array.isArray(activePropsData.props) ? activePropsData.props : []).filter((prop) => {
    if (query && !String(prop.player_name || '').toLowerCase().includes(query)) return false;
    if (category !== 'ALL' && propCategory(prop.stat_id) !== category) return false;
    return true;
  });

  if (!props.length) {
    results.innerHTML = '<div class="props-loading">No matching DraftKings props are currently available.</div>';
    return;
  }

  const grouped = new Map();
  for (const prop of props) {
    const key = `${prop.player_id || prop.player_name}`;
    if (!grouped.has(key)) grouped.set(key, { player: prop.player_name, position: prop.position, teamId: prop.team_id, props: [] });
    grouped.get(key).props.push(prop);
  }

  const groups = [...grouped.values()].slice(0, query ? 30 : 18);
  results.innerHTML = groups.map((group) => `
    <article class="prop-player-card">
      <div class="prop-player-head">
        <div><strong>${group.player || 'Player'}</strong><span>${group.position || 'NFL'}${group.teamId ? ` · ${String(group.teamId).replace(/_NFL$/, '').replaceAll('_', ' ')}` : ''}</span></div>
        <span class="prop-count">${group.props.length}</span>
      </div>
      <div class="prop-options">
        ${group.props.map((prop) => {
          const leg = normalizePropLeg(event, prop);
          if (!leg) return '';
          const selected = state.legs.some((item) => item.id === leg.id);
          const lineText = prop.line !== null && prop.line !== undefined && prop.line !== '' ? ` ${prop.line}` : '';
          const sideText = prop.side ? cap(prop.side) : '';
          return `<button class="prop-option ${selected ? 'selected' : ''}" data-prop-id="${encodeURIComponent(prop.odd_id)}">
            <span>${prettyStat(prop.stat_id)}</span>
            <strong>${sideText}${lineText}</strong>
            <small>DK ${formatOdds(leg.odds)}</small>
          </button>`;
        }).join('')}
      </div>
    </article>
  `).join('');

  results.querySelectorAll('.prop-option').forEach((button) => {
    button.addEventListener('click', () => {
      const oddId = decodeURIComponent(button.dataset.propId || '');
      const prop = activePropsData.props.find((item) => item.odd_id === oddId);
      if (!prop) return;
      togglePropLeg(event, prop);
    });
  });
}

function togglePropLeg(event, prop) {
  const leg = normalizePropLeg(event, prop);
  if (!leg) return;
  const existing = state.legs.findIndex((item) => item.id === leg.id);
  if (existing >= 0) {
    state.legs.splice(existing, 1);
  } else {
    state.legs.push({ ...leg, eventId: event.id, eventName: event.name, sport: event.sport, time: event.time });
  }
  renderSlip();
  renderPropResults();
}

async function openPlayerProps(eventId) {
  const event = sampleEvents.find((item) => item.id === eventId);
  if (!event || event.sport !== 'NFL') return;
  const explorer = ensurePropsExplorer();
  if (!explorer) return;
  explorer.classList.remove('hidden');
  activePropsEventId = event.id;
  document.querySelector('#propsTitle').textContent = event.name;
  document.querySelector('#propsMeta').textContent = `${event.time} · Full-game DraftKings player props`;
  document.querySelector('#propSearch').value = '';
  document.querySelector('#propCategory').value = 'ALL';

  if (propsCache.has(event.id)) {
    activePropsData = propsCache.get(event.id);
    renderPropResults();
    explorer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  document.querySelector('#propsResults').innerHTML = '<div class="props-loading">Loading live DraftKings player props…</div>';
  explorer.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const response = await fetch(`${LIVE_PROPS_URL}?league=NFL&event_id=${encodeURIComponent(event.id)}`, {
      method: 'GET',
      headers: liveHeaders(),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`draftkings-event-props ${response.status}`);
    const data = await response.json();
    propsCache.set(event.id, data);
    activePropsData = data;
    if (activePropsEventId === event.id) renderPropResults();
    enhanceEventPropButtons();
  } catch (error) {
    console.warn('Unable to load player props', error);
    document.querySelector('#propsResults').innerHTML = '<div class="props-loading">Player props are temporarily unavailable for this game.</div>';
  }
}

const baseRenderMarketsForProps = renderMarkets;
renderMarkets = function renderMarketsWithProps() {
  baseRenderMarketsForProps();
  enhanceEventPropButtons();
};

ensurePropsExplorer();
enhanceEventPropButtons();

document.addEventListener('click', (event) => {
  if (event.target.closest?.('.remove-leg') && activePropsData) {
    window.setTimeout(renderPropResults, 0);
  }
});
