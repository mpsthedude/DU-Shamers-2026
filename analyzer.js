const LIVE_ANALYZE_URL = `${LIVE_API_ROOT}/analyze-ticket`;
let lastTicketAnalysis = null;

function pct(value, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(digits)}%` : '—';
}

function pp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number > 0 ? '+' : ''}${number.toFixed(2)} pp`;
}

function analyzerPrice(value) {
  const number = toAmericanNumber(value);
  return number === null ? '—' : formatOdds(number);
}

function fairContextLabel(value) {
  const labels = {
    draftkings_price_more_favorable_than_fair: 'DK price more favorable than fair reference',
    draftkings_price_less_favorable_than_fair: 'DK price less favorable than fair reference',
    near_fair: 'DK price near fair reference',
    unavailable: 'Fair reference unavailable',
  };
  return labels[value] || 'Fair reference unavailable';
}

function movementText(leg) {
  const parts = [];
  if (leg?.dk?.open_odds && leg?.dk?.odds && Number(leg.dk.open_odds) !== Number(leg.dk.odds)) {
    parts.push(`price ${analyzerPrice(leg.dk.open_odds)} → ${analyzerPrice(leg.dk.odds)}`);
  }
  if (leg?.dk?.open_line !== null && leg?.dk?.open_line !== undefined && leg?.dk?.line !== null && leg?.dk?.line !== undefined && Number(leg.dk.open_line) !== Number(leg.dk.line)) {
    parts.push(`line ${leg.dk.open_line} → ${leg.dk.line}`);
  }
  return parts.length ? parts.join(' · ') : 'No opening-to-current change returned';
}

function crossBookText(leg) {
  const count = Number(leg?.cross_book?.same_line_book_count || 0);
  const rank = Number(leg?.cross_book?.draftkings_price_rank || 0);
  if (!count || !rank) return 'No same-line comparison available';
  const offers = Array.isArray(leg.cross_book.offers) ? leg.cross_book.offers : [];
  const best = offers[0];
  const bestText = best ? ` · best shown ${String(best.bookmaker).toUpperCase()} ${analyzerPrice(best.odds)}` : '';
  return `DraftKings price rank ${rank} of ${count}${bestText}`;
}

function renderLiveAnalysis(data) {
  lastTicketAnalysis = data;
  const panel = document.querySelector('#analyzer');
  const summary = document.querySelector('#analysisSummary');
  const legsEl = document.querySelector('#analysisLegs');
  const badge = panel?.querySelector('.status-pill');
  const disclaimer = panel?.querySelector('.analysis-disclaimer');
  if (!panel || !summary || !legsEl) return;

  panel.classList.remove('hidden');
  if (badge) {
    badge.classList.remove('demo');
    badge.textContent = 'Live market analysis';
    badge.style.color = 'var(--accent-2)';
  }

  const ticket = data?.ticket || {};
  const intelligenceStatus = data?.sportsbook_intelligence?.status || 'not_configured';
  summary.innerHTML = `
    <div class="analysis-metric"><span>Market source</span><strong>${data?.market_data_source || 'SportsGameOdds'}</strong></div>
    <div class="analysis-metric"><span>Legs analyzed</span><strong>${ticket.leg_count ?? state.legs.length}</strong></div>
    <div class="analysis-metric"><span>Independent implied</span><strong>${pct(ticket.independent_implied_probability)}</strong></div>
    <div class="analysis-metric"><span>Same-game correlation</span><strong>${ticket.same_game_correlation_warning ? 'Review required' : 'No flag'}</strong></div>
  `;

  legsEl.innerHTML = (Array.isArray(data?.legs) ? data.legs : []).map((leg) => {
    const rank = Number(leg?.cross_book?.draftkings_price_rank || 0);
    const count = Number(leg?.cross_book?.same_line_book_count || 0);
    const rankClass = rank === 1 && count > 1 ? 'strong' : rank === count && count > 1 ? 'weak' : 'neutral';
    const rankLabel = rank && count ? `DK #${rank}/${count}` : 'DK MARKET';
    return `
      <article class="analysis-leg">
        <div>
          <strong>${leg.selection || 'Selection'} <span class="muted">${analyzerPrice(leg?.dk?.odds)}</span></strong>
          <p><b>Fair reference:</b> ${analyzerPrice(leg?.fair?.odds)} · ${fairContextLabel(leg?.fair?.context)}${Number.isFinite(Number(leg?.fair?.implied_probability_gap_pp)) ? ` (${pp(leg.fair.implied_probability_gap_pp)})` : ''}</p>
          <p><b>Cross-book:</b> ${crossBookText(leg)}</p>
          <p><b>Movement:</b> ${movementText(leg)}</p>
        </div>
        <span class="rating ${rankClass}">${rankLabel}</span>
      </article>`;
  }).join('');

  if (disclaimer) {
    const correlationNote = ticket.same_game_correlation_warning
      ? ` ${ticket.note || 'Same-game legs require DraftKings correlation-adjusted pricing.'}`
      : '';
    const intelligenceNote = intelligenceStatus === 'connected'
      ? ' Sportsbook Intelligence enrichment is connected for this run.'
      : ' Live market facts are active. The separate Sportsbook Intelligence MCP is still local-only; this analyzer already contains the hosted hook, so news/injury/weather/source-corroboration enrichment will drop into the same response once that service is exposed.';
    disclaimer.textContent = `This analysis reports observed market facts and does not manufacture an edge or model win probability.${correlationNote}${intelligenceNote}`;
  }

  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function analyzerPayload() {
  return {
    stake: selectedStake(),
    execution_book: 'draftkings',
    legs: state.legs.map((leg) => ({
      event_id: leg.providerEventId || leg.eventId || null,
      odd_id: leg.providerOddId || null,
      odds: leg.odds,
      selection: leg.selection,
      market: leg.market,
      event_name: leg.eventName,
      event_start_at: leg.eventStartAt || null,
      fair_odds: leg.fairOdds ?? null,
      player_name: leg.playerName ?? null,
      stat_id: leg.statId ?? null,
      bet_type: leg.betType ?? null,
      side: leg.side ?? null,
      line: leg.line ?? null,
    })),
  };
}

async function analyzeLiveTicket() {
  if (!state.legs.length) return showToast('Add at least one selection first.');
  if (!selectedStake()) return showToast('Choose the $50/$50 or Let It Ride option first.');
  if (state.legs.some((leg) => !(leg.providerEventId || leg.eventId) || !leg.providerOddId)) {
    return showToast('Live provider IDs are required. Wait for the DraftKings feed to load, then build the ticket.');
  }

  const button = document.querySelector('#analyzeButton');
  const original = button?.textContent || 'Analyze my ticket';
  if (button) {
    button.disabled = true;
    button.textContent = 'Analyzing live markets…';
  }

  try {
    const response = await fetch(LIVE_ANALYZE_URL, {
      method: 'POST',
      headers: { ...liveHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(analyzerPayload()),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`analyze-ticket ${response.status}`);
    renderLiveAnalysis(await response.json());
  } catch (error) {
    console.warn('Live ticket analysis failed', error);
    showToast('Live analysis is temporarily unavailable.');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function replaceAnalyzerHandler() {
  const oldButton = document.querySelector('#analyzeButton');
  if (!oldButton || oldButton.dataset.liveAnalyzer === 'true') return;
  const newButton = oldButton.cloneNode(true);
  newButton.dataset.liveAnalyzer = 'true';
  oldButton.replaceWith(newButton);
  newButton.addEventListener('click', analyzeLiveTicket);
}

replaceAnalyzerHandler();
