import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SGO_URL = "https://api.sportsgameodds.com/v2/events";
const BOOKS = ["draftkings", "fanduel", "betmgm", "caesars"];

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function american(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value !== 0) return Math.trunc(value);
  if (typeof value !== "string") return null;
  const parsed = Number(value.trim().replace("+", ""));
  return Number.isFinite(parsed) && parsed !== 0 ? Math.trunc(parsed) : null;
}
function decimalOdds(value: number | null): number | null {
  if (!value) return null;
  return value > 0 ? 1 + value / 100 : 1 + 100 / Math.abs(value);
}
function implied(value: number | null): number | null {
  if (!value) return null;
  return value > 0 ? 100 / (value + 100) : Math.abs(value) / (Math.abs(value) + 100);
}
function offerLine(book: any): number | null {
  const raw = book?.overUnder ?? book?.spread;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
function sameLine(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  return a !== null && b !== null && Math.abs(a - b) < 0.0001;
}
function dataRows(payload: any): any[] {
  const data = payload?.data;
  if (Array.isArray(data)) return data.filter(v => v && typeof v === "object");
  if (data && typeof data === "object") return Object.values(data).filter(v => v && typeof v === "object");
  return [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const apiKey = Deno.env.get("SPORTSGAMEODDS_API_KEY");
  if (!apiKey) return json({ error: "sportsgameodds_not_configured" }, 503);

  const body = await req.json().catch(() => null);
  const legs = Array.isArray(body?.legs) ? body.legs.slice(0, 12) : [];
  if (!legs.length) return json({ error: "legs_required" }, 400);

  const validLegs = legs.filter((leg: any) => leg && typeof leg === "object" && leg.event_id && leg.odd_id);
  if (!validLegs.length) return json({ error: "provider_ids_required" }, 400);

  const grouped = new Map<string, any[]>();
  for (const leg of validLegs) {
    const id = String(leg.event_id);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id)!.push(leg);
  }

  const eventResults = new Map<string, any>();
  await Promise.all([...grouped.entries()].map(async ([eventId, eventLegs]) => {
    const oddIds = [...new Set(eventLegs.map((leg: any) => String(leg.odd_id)))];
    const params = new URLSearchParams({
      eventID: eventId,
      oddsAvailable: "true",
      oddID: oddIds.join(","),
      bookmakerID: BOOKS.join(","),
      includeAltLines: "false",
      includeOpenCloseOdds: "true",
      limit: "1",
    });
    try {
      const response = await fetch(`${SGO_URL}?${params.toString()}`, { headers: { "x-api-key": apiKey, "Accept": "application/json" } });
      if (!response.ok) return;
      const payload = await response.json();
      const event = dataRows(payload)[0];
      if (event) eventResults.set(eventId, event);
    } catch { /* one failed event should not discard other market evidence */ }
  }));

  const analyzed = validLegs.map((leg: any) => {
    const event = eventResults.get(String(leg.event_id));
    const odd = event?.odds?.[leg.odd_id] ?? null;
    const dk = odd?.byBookmaker?.draftkings ?? null;
    const dkOdds = american(dk?.odds ?? leg.odds);
    const dkLine = offerLine(dk) ?? (Number.isFinite(Number(leg.line)) ? Number(leg.line) : null);
    const fairOdds = american(odd?.fairOdds ?? leg.fair_odds);
    const fairImplied = implied(fairOdds);
    const dkImplied = implied(dkOdds);

    const sameLineBooks = BOOKS.map((bookmaker) => {
      const book = odd?.byBookmaker?.[bookmaker];
      if (!book || book.available !== true) return null;
      const price = american(book.odds);
      if (!price) return null;
      const line = offerLine(book);
      if (!sameLine(line, dkLine)) return null;
      return { bookmaker, odds: price, line, decimal: decimalOdds(price) };
    }).filter(Boolean) as any[];
    sameLineBooks.sort((a,b) => (b.decimal ?? 0) - (a.decimal ?? 0));
    const dkRankIndex = sameLineBooks.findIndex((item) => item.bookmaker === "draftkings");

    const currentLine = dkLine;
    const openLineRaw = dk?.openOverUnder ?? dk?.openSpread;
    const openLineNum = Number(openLineRaw);
    const openLine = Number.isFinite(openLineNum) ? openLineNum : null;
    const openOdds = american(dk?.openOdds);

    let fairContext = "unavailable";
    let impliedGapPp: number | null = null;
    if (fairImplied !== null && dkImplied !== null) {
      impliedGapPp = Number(((fairImplied - dkImplied) * 100).toFixed(2));
      if (Math.abs(impliedGapPp) < 0.5) fairContext = "near_fair";
      else if (impliedGapPp > 0) fairContext = "draftkings_price_more_favorable_than_fair";
      else fairContext = "draftkings_price_less_favorable_than_fair";
    }

    return {
      event_id: leg.event_id,
      odd_id: leg.odd_id,
      selection: leg.selection ?? odd?.marketName ?? leg.odd_id,
      event_name: leg.event_name ?? null,
      market: leg.market ?? null,
      player_name: leg.player_name ?? null,
      stat_id: leg.stat_id ?? null,
      dk: {
        odds: dkOdds,
        implied_probability: dkImplied,
        line: currentLine,
        open_odds: openOdds,
        open_line: openLine,
        last_updated_at: dk?.lastUpdatedAt ?? null,
      },
      fair: {
        odds: fairOdds,
        implied_probability: fairImplied,
        line: odd?.fairOverUnder ?? odd?.fairSpread ?? null,
        context: fairContext,
        implied_probability_gap_pp: impliedGapPp,
      },
      cross_book: {
        same_line_book_count: sameLineBooks.length,
        draftkings_price_rank: dkRankIndex >= 0 ? dkRankIndex + 1 : null,
        offers: sameLineBooks.map(({ decimal, ...rest }) => rest),
      },
      market_name: odd?.marketName ?? null,
      observed_at: new Date().toISOString(),
    };
  });

  const eventCounts = new Map<string, number>();
  const playerCounts = new Map<string, number>();
  for (const leg of validLegs) {
    const event = String(leg.event_id); eventCounts.set(event, (eventCounts.get(event) || 0) + 1);
    if (leg.player_name) { const player = String(leg.player_name); playerCounts.set(player, (playerCounts.get(player) || 0) + 1); }
  }
  const sameGameEvents = [...eventCounts.entries()].filter(([, count]) => count > 1).map(([event_id, leg_count]) => ({ event_id, leg_count }));
  const samePlayerGroups = [...playerCounts.entries()].filter(([, count]) => count > 1).map(([player_name, leg_count]) => ({ player_name, leg_count }));

  const independentDecimal = validLegs.reduce((product: number, leg: any) => {
    const d = decimalOdds(american(leg.odds)); return d ? product * d : product;
  }, 1);
  const independentImplied = independentDecimal > 1 ? 1 / independentDecimal : null;

  let intelligence: any = null;
  let intelligenceStatus = "not_configured";
  const intelligenceUrl = Deno.env.get("SPORTSBOOK_INTELLIGENCE_URL");
  const intelligenceToken = Deno.env.get("SPORTSBOOK_INTELLIGENCE_TOKEN");
  if (intelligenceUrl) {
    try {
      const response = await fetch(intelligenceUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(intelligenceToken ? { "Authorization": `Bearer ${intelligenceToken}` } : {}),
        },
        body: JSON.stringify({ execution_book: "draftkings", stake: body?.stake ?? null, legs: validLegs }),
      });
      if (response.ok) { intelligence = await response.json(); intelligenceStatus = "connected"; }
      else intelligenceStatus = `http_${response.status}`;
    } catch { intelligenceStatus = "unreachable"; }
  }

  return json({
    generated_at: new Date().toISOString(),
    execution_book: "draftkings",
    market_data_source: "SportsGameOdds",
    ticket: {
      leg_count: validLegs.length,
      independent_implied_probability: independentImplied,
      same_game_correlation_warning: sameGameEvents.length > 0,
      same_game_events: sameGameEvents,
      same_player_groups: samePlayerGroups,
      note: sameGameEvents.length ? "Independent parlay probability/price is not an SGP probability. DraftKings' correlation-adjusted ticket price is authoritative." : "Independent price math is informational; the commissioner records the actual DraftKings ticket price after placement.",
    },
    legs: analyzed,
    sportsbook_intelligence: { status: intelligenceStatus, data: intelligence },
  });
});
