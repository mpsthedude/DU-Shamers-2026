import { paidHandler } from "../_shared/paid.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const SGO_URL = "https://api.sportsgameodds.com/v2/events";
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
function rows(payload: any): any[] { const data = payload?.data; if (Array.isArray(data)) return data.filter(v => v && typeof v === "object"); if (data && typeof data === "object") return Object.values(data).filter(v => v && typeof v === "object"); return []; }
function playerMap(event: any): Map<string, any> { const result = new Map<string, any>(); const players = event?.players; if (Array.isArray(players)) { for (const p of players) if (p && typeof p === "object" && p.playerID) result.set(String(p.playerID), p); } else if (players && typeof players === "object") { for (const [embeddedId, p] of Object.entries(players)) { if (!p || typeof p !== "object") continue; const player = p as any; const id = player.playerID || embeddedId; if (id) result.set(String(id), { ...player, playerID: id }); } } return result; }
function displayName(player: any, fallback: string) { return player?.names?.display || player?.names?.long || player?.name || fallback; }
Deno.serve(paidHandler(async (req: Request, paidFetch: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const apiKey = Deno.env.get("SPORTSGAMEODDS_API_KEY"); if (!apiKey) return json({ error: "sportsgameodds_not_configured" }, 503);
  const incoming = new URL(req.url); const eventId = (incoming.searchParams.get("event_id") || "").trim(); const league = (incoming.searchParams.get("league") || "NFL").trim().toUpperCase();
  if (!eventId) return json({ error: "event_id_required" }, 400); if (!new Set(["NFL", "NCAAF"]).has(league)) return json({ error: "unsupported_league" }, 400);
  const params = new URLSearchParams({ eventID: eventId, leagueID: league, oddsAvailable: "true", bookmakerID: "draftkings", includeAltLines: "false", limit: "1" });
  const response = await paidFetch(`${SGO_URL}?${params.toString()}`, { headers: { "x-api-key": apiKey, "Accept": "application/json" } });
  if (!response.ok) return json({ error: `sportsgameodds_http_${response.status}` }, response.status === 429 ? 429 : 502); const payload = await response.json(); if (payload?.success === false) return json({ error: "sportsgameodds_error" }, 502);
  const event = rows(payload)[0]; if (!event) return json({ error: "event_not_found" }, 404); const players = playerMap(event); const props: any[] = []; const odds = event?.odds && typeof event.odds === "object" ? Object.values(event.odds) : [];
  for (const raw of odds) { const odd: any = raw; if (!odd || typeof odd !== "object" || !odd.statEntityID || odd.periodID !== "game") continue; const playerId = String(odd.statEntityID); if (!players.has(playerId)) continue; const book = odd?.byBookmaker?.draftkings; if (!book || book.available !== true || book.odds == null) continue; const player = players.get(playerId); props.push({ odd_id: odd.oddID ?? null, player_id: playerId, player_name: displayName(player, playerId), position: player.position ?? null, team_id: player.teamID ?? null, market_name: odd.marketName ?? null, stat_id: odd.statID ?? null, period_id: odd.periodID ?? null, bet_type: odd.betTypeID ?? null, side: odd.sideID ?? null, odds: book.odds ?? null, line: book.overUnder ?? book.spread ?? odd.bookOverUnder ?? null, fair_odds: odd.fairOdds ?? null, fair_line: odd.fairOverUnder ?? null, last_updated_at: book.lastUpdatedAt ?? null }); }
  props.sort((a,b) => String(a.player_name).localeCompare(String(b.player_name)) || String(a.stat_id).localeCompare(String(b.stat_id)) || String(a.side).localeCompare(String(b.side)));
  return json({ bookmaker: "draftkings", event_id: event.eventID ?? eventId, league: event.leagueID ?? league, starts_at: event?.status?.startsAt ?? null, teams: event.teams ?? null, prop_count: props.length, props, generated_at: new Date().toISOString() });
}));
