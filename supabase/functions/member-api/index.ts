import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const LEAGUE_NAME = "DU Shamers";
const ESPN_LEAGUE_ID = 290466;
const YEAR = 2026;
const TIMEZONE = "America/New_York";
const ESPN_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
const SGO_URL = "https://api.sportsgameodds.com/v2/events";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function bearer(req: Request) {
  const raw = req.headers.get("authorization") || "";
  return raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : "";
}
function teamName(team: any): string {
  if (typeof team?.name === "string" && team.name.trim()) return team.name.trim();
  return `${team?.location ?? "Unknown"} ${team?.nickname ?? "Unknown"}`.trim();
}
function easternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: get("weekday"), year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), hour: Number(get("hour")), minute: Number(get("minute")) };
}
function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  for (let i = 0; i < 3; i++) {
    const parts = fmt.formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
    const represented = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    guess -= represented - Date.UTC(year, month - 1, day, hour, minute);
  }
  return new Date(guess);
}
function weeklyHardDeadline(now = new Date()): Date {
  const p = easternParts(now);
  const weekdayIndex: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const daysUntilSunday = (7 - (weekdayIndex[p.weekday] ?? 0)) % 7;
  const target = new Date(Date.UTC(p.year, p.month - 1, p.day + daysUntilSunday, 12, 0, 0));
  return zonedToUtc(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), 11, 0);
}
function awardWindowOpen(award: any, now = new Date()) {
  if (!award?.identified_at || !award?.source_observed_at || award.source_status !== "WINNER_IDENTIFIED"
    || award.requires_commissioner_resolution || award.week < 1 || award.week > 14) return false;
  const identified = new Date(award.identified_at);
  if (!Number.isFinite(identified.getTime())) return false;
  const deadline = weeklyHardDeadline(identified);
  const p = easternParts(deadline);
  const tuesday = new Date(Date.UTC(p.year, p.month - 1, p.day - 5));
  const opens = zonedToUtc(tuesday.getUTCFullYear(), tuesday.getUTCMonth()+1, tuesday.getUTCDate(), 9, 0);
  const observed = new Date(award.source_observed_at);
  return identified <= now && observed >= opens && observed <= now && now >= opens && now < deadline
    && easternParts(identified).year === YEAR;
}
function american(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^[+-]?\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && Math.abs(parsed) >= 100 && Math.abs(parsed) <= 2147483647 ? parsed : null;
}
function numericLine(value: unknown): number | null {
  if (value == null) return null;
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") throw new Error("invalid_line");
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n)>100000) throw new Error("invalid_line");
  return n;
}
function requestedLegs(value: any) {
  if (!Array.isArray(value) || value.length<1 || value.length>12) throw new Error("legs_limit");
  const seen = new Set();
  return value.map((leg: any) => {
    if (typeof leg?.event_id !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(leg.event_id)
      || typeof leg?.odd_id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(leg.odd_id)
      || !["NFL","NCAAF"].includes(leg.sport) || american(leg.odds)===null) throw new Error("invalid_leg");
    const key = leg.event_id + ":" + leg.odd_id;
    if (seen.has(key)) throw new Error("duplicate_selection");
    seen.add(key);
    return { event_id: leg.event_id, odd_id: leg.odd_id, sport: leg.sport,
      odds: american(leg.odds), line: numericLine(leg.line) };
  });
}
async function espnTeams(): Promise<{ team_id: string, team_name: string }[]> {
  const espnS2 = Deno.env.get("ESPN_S2");
  const swid = Deno.env.get("ESPN_SWID") || Deno.env.get("SWID");
  if (!espnS2 || !swid) throw new Error("espn_credentials_not_configured");
  const url = new URL(`${ESPN_BASE}/seasons/${YEAR}/segments/0/leagues/${ESPN_LEAGUE_ID}`);
  url.searchParams.append("view", "mTeam");
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "du-shamers-league-bank/1.0", Cookie: `espn_s2=${espnS2}; SWID=${swid}` } });
  if (!response.ok) throw new Error(`espn_http_${response.status}`);
  const payload = await response.json();
  return (Array.isArray(payload?.teams) ? payload.teams : []).filter((t: any) => Number.isInteger(t?.id)).map((t: any) => ({ team_id: String(t.id), team_name: teamName(t) })).sort((a: any,b: any) => a.team_name.localeCompare(b.team_name));
}
async function authenticatedContext(req: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("server_not_configured");
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const token = bearer(req);
  if (!token || token.startsWith("sb_publishable_")) return { error: json({ error: "member_sign_in_required" }, 401) } as any;
  const { data: userData, error: userError } = await db.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user?.id || !user.email) return { error: json({ error: "member_sign_in_required" }, 401) } as any;

  await db.from("profiles").upsert({ id: user.id, display_name: user.user_metadata?.display_name || user.email.split("@")[0] }, { onConflict: "id", ignoreDuplicates: true });
  const { data: league } = await db.from("leagues").select("id,name").eq("name", LEAGUE_NAME).single();
  if (!league) return { error: json({ error: "league_not_found" }, 500) } as any;
  const email = user.email.toLowerCase();
  const { data: allowed } = await db.from("commissioner_allowlist").select("id").eq("league_id", league.id).eq("email", email).maybeSingle();
  if (allowed) {
    const { data: current } = await db.from("league_members").select("id,role,fantasy_team_id,fantasy_team_name").eq("league_id", league.id).eq("profile_id", user.id).maybeSingle();
    if (!current) await db.from("league_members").insert({ league_id: league.id, profile_id: user.id, role: "COMMISSIONER" });
    else if (current.role !== "COMMISSIONER") await db.from("league_members").update({ role: "COMMISSIONER" }).eq("id", current.id);
  }
  const { data: membership } = await db.from("league_members").select("id,role,fantasy_team_id,fantasy_team_name").eq("league_id", league.id).eq("profile_id", user.id).maybeSingle();
  return { db, user, league, membership, isCommissioner: Boolean(allowed) };
}
async function currentSeasonAndAward(db: any, leagueId: string) {
  const { data: season } = await db.from("seasons").select("id,year,weekly_award_cents").eq("league_id", leagueId).eq("year", YEAR).single();
  if (!season) return { season: null, award: null };
  const { data: award } = await db.from("weekly_awards").select("id,week,fantasy_team_id,fantasy_team_name,score,source_status,identified_at,source_observed_at,requires_commissioner_resolution").eq("season_id", season.id).order("week", { ascending: false }).limit(1).maybeSingle();
  return { season, award };
}
function verifiedLeg(event: any, leg: any, now = new Date()) {
  if (event?.eventID !== leg.event_id || event?.leagueID !== leg.sport) throw new Error("event_mismatch");
  const startsAt = new Date(event?.status?.startsAt);
  if (!Number.isFinite(startsAt.getTime()) || startsAt<=now || event.status?.started === true
    || event.status?.cancelled === true || event.status?.ended === true) throw new Error("event_already_started");
  const odd = event?.odds?.[leg.odd_id];
  const book = odd?.byBookmaker?.draftkings;
  const odds = american(book?.odds);
  if (!odd || odd.oddID !== leg.odd_id || !book || book.available !== true || odds === null
    || odd.periodID !== "game" || !["ml","sp","ou","yn"].includes(odd.betTypeID)) throw new Error("selection_unavailable");
  const line = numericLine(odd.betTypeID === "sp" ? book.spread : odd.betTypeID === "ou" ? book.overUnder : null);
  if ((["sp","ou"].includes(odd.betTypeID) && line===null)) throw new Error("selection_unavailable");
  if (odds !== leg.odds || line !== leg.line) throw new Error("selection_changed");
  const name = (team: any) => team?.names?.long || team?.names?.medium || team?.name || team?.teamID;
  const home = name(event.teams?.home), away = name(event.teams?.away);
  if (!home || !away) throw new Error("selection_unavailable");
  const entity = odd.statEntityID;
  const players = Array.isArray(event.players) ? event.players : Object.entries(event.players || {}).map(([id,p]: any) => ({...p, playerID:p.playerID || id}));
  const player = players.find((p: any) => p.playerID === entity);
  const entityName = entity === "home" ? home : entity === "away" ? away : entity === "all" ? "Game" : player?.names?.display || player?.names?.long || player?.name;
  if (!entityName || !odd.marketName || !odd.sideID) throw new Error("selection_unavailable");
  const lineLabel = line === null ? "" : " " + (odd.betTypeID === "sp" && line>0 ? "+" : "") + line;
  return { sport:event.leagueID,event_id:event.eventID,odd_id:odd.oddID,event_name:away + " @ " + home,
    market_name:String(odd.marketName),selection:entityName + " · " + odd.marketName + " · " + odd.sideID + lineLabel,
    american_odds:odds,line_value:line,event_start_at:startsAt.toISOString(),observed_at:now.toISOString() };
}
async function validateLiveLegs(legs: any[]) {
  const apiKey = Deno.env.get("SPORTSGAMEODDS_API_KEY");
  if (!apiKey) throw new Error("sportsgameodds_not_configured");
  const grouped = new Map<string, any[]>();
  for (const leg of legs) {
    if (!grouped.has(leg.event_id)) grouped.set(leg.event_id, []);
    grouped.get(leg.event_id)!.push(leg);
  }
  const checked: any[] = [];
  for (const [eventId, eventLegs] of grouped) {
    const params = new URLSearchParams({ eventID:eventId,oddsAvailable:"true",bookmakerID:"draftkings",
      oddID:eventLegs.map(l=>l.odd_id).join(","),includeAltLines:"false",limit:"1" });
    const response = await fetch(SGO_URL + "?" + params, { headers:{"x-api-key":apiKey,Accept:"application/json"},signal:AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("selection_provider_unavailable");
    const payload = await response.json();
    const event = Array.isArray(payload?.data) ? payload.data.find((e:any)=>e.eventID===eventId) : null;
    if (!event || payload.success===false) throw new Error("event_unavailable");
    for (const leg of eventLegs) checked.push(verifiedLeg(event,leg));
  }
  return checked;
}
function weeklyError(error: any) {
  const known = new Set(["invalid_submission","invalid_weekly_choice","season_not_found","approved_team_membership_required",
    "submission_retry_conflict","weekly_winner_not_ready","not_this_weeks_high_scorer","stale_weekly_award",
    "weekly_submission_window_closed","weekly_decision_already_locked","weekly_ticket_already_submitted",
    "allocation_exceeded","invalid_legs","duplicate_selection","invalid_or_stale_selection"]);
  if (known.has(error?.message)) return json({error:error.message},409);
  console.error("weekly_submission_failed",error?.code);
  return json({error:"weekly_submission_failed"},500);
}

async function claimResult(db: any, args: Record<string, unknown>) {
  const { data, error } = await db.rpc("manage_team_claim", args);
  if (!error) return json(data);
  const known = new Set(["member_sign_in_required", "invalid_claim_action", "claim_note_too_long",
    "league_not_found", "commissioner_not_authorized", "invalid_team", "active_claim_already_exists",
    "team_already_assigned", "team_already_claimed", "team_claim_pending_or_approved",
    "claim_not_found", "claim_already_resolved"]);
  if (known.has(error.message)) return json({ error: error.message }, 409);
  console.error("claim_transaction_failed", error.code);
  return json({ error: "claim_transaction_failed" }, 500);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const ctx: any = await authenticatedContext(req);
  if (ctx.error) return ctx.error;
  const { db, user, league } = ctx;
  let membership = ctx.membership;

  if (req.method === "GET") {
    const { season, award } = await currentSeasonAndAward(db, league.id);
    const { data: claim } = await db.from("team_claims").select("id,fantasy_team_id,fantasy_team_name,status,requested_at,reviewed_at,review_note").eq("league_id", league.id).eq("profile_id", user.id).in("status", ["PENDING","APPROVED"]).order("requested_at", { ascending: false }).limit(1).maybeSingle();
    const teams = await espnTeams().catch(() => []);
    const { data: occupied } = await db.from("league_members").select("fantasy_team_id").eq("league_id", league.id).not("fantasy_team_id", "is", null);
    const { data: pending } = await db.from("team_claims").select("fantasy_team_id").eq("league_id", league.id).eq("status", "PENDING");
    const occupiedIds = new Set((occupied || []).map((r: any) => String(r.fantasy_team_id)));
    const pendingIds = new Set((pending || []).map((r: any) => String(r.fantasy_team_id)));
    const eligible = Boolean(award?.source_status === "WINNER_IDENTIFIED" && membership?.fantasy_team_id && String(award.fantasy_team_id) === String(membership.fantasy_team_id));
    let proposal = null;
    if (season && award && membership) {
      const { data: decision } = await db.from("weekly_decisions").select("id,choice,cash_payout_cents,wager_budget_cents,decided_at").eq("weekly_award_id", award.id).eq("member_id", membership.id).maybeSingle();
      if (decision) {
        const { data: found } = await db.from("bet_proposals").select("id,status,proposed_stake_cents,estimated_american_odds,estimated_return_cents,submitted_at,first_event_start_at,hard_deadline_at").eq("weekly_decision_id", decision.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        proposal = found ? { ...found, decision } : { decision };
      }
    }
    return json({
      signed_in: true,
      user: { id: user.id, email: user.email },
      membership,
      claim,
      current_award: award,
      eligible_weekly_winner: eligible,
      submission_window_open: awardWindowOpen(award),
      team_directory: teams.map((team) => ({ ...team, claimed: occupiedIds.has(team.team_id), pending_claim: pendingIds.has(team.team_id) })),
      current_proposal: proposal,
    });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const raw = await req.text();
  if (raw.length>32768) return json({error:"request_too_large"},413);
  let body;
  try { body=JSON.parse(raw); } catch { return json({error:"invalid_json"},400); }
  const action = body?.action;

  if (action === "claim_team") {
    const teamId = String(body?.fantasy_team_id || "").trim();
    if (!/^[0-9]{1,20}$/.test(teamId)) return json({ error: "invalid_team" }, 400);
    let teams;
    try { teams = await espnTeams(); }
    catch { return json({ error: "team_directory_unavailable" }, 503); }
    const team = teams.find((t) => t.team_id === teamId);
    if (!team) return json({ error: "unknown_espn_team" }, 400);
    return claimResult(db, { p_actor: user.id, p_league: league.id,
      p_action: ctx.isCommissioner ? "SELF_ASSIGN" : "REQUEST",
      p_team_id: team.team_id, p_team_name: team.team_name });
  }

  if (action === "cancel_claim") {
    const claimId = String(body?.claim_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claimId))
      return json({ error: "claim_id_required" }, 400);
    return claimResult(db, { p_actor: user.id, p_league: league.id, p_action: "CANCEL", p_claim: claimId });
  }

  if (action === "submit_weekly_bet") {
    if (!membership?.id || !membership?.fantasy_team_id) return json({error:"approved_team_membership_required"},403);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(body?.request_id || "") || !uuid.test(body?.award_id || "")) return json({error:"invalid_submission"},400);
    const choice = ["split","SPLIT_50_50"].includes(body?.choice) ? "SPLIT_50_50" :
      ["ride","LET_IT_RIDE_100"].includes(body?.choice) ? "LET_IT_RIDE_100" : null;
    if (!choice) return json({error:"invalid_weekly_choice"},400);
    let legs;
    try { legs=requestedLegs(body.legs); } catch(error) { return json({error:(error as Error).message},400); }
    const {season} = await currentSeasonAndAward(db,league.id);
    if (!season) return json({error:"season_not_found"},409);
    const args = {p_actor:user.id,p_season:season.id,p_award:body.award_id,p_request:body.request_id,p_choice:choice,
      p_request_body:{award_id:body.award_id,choice,legs}};
    const preflight = await db.rpc("submit_weekly_ticket",args);
    if (preflight.error) return weeklyError(preflight.error);
    if (preflight.data?.ok) return json(preflight.data);
    if (preflight.data?.validation_required !== true) return json({error:"weekly_submission_failed"},500);
    let checked;
    try { checked=await validateLiveLegs(legs); }
    catch(error) {
      const known = ["selection_changed","selection_unavailable","event_already_started","event_mismatch","event_unavailable","invalid_line"];
      const message = (error as Error).message;
      return json({error:known.includes(message)?message:"selection_provider_unavailable"},409);
    }
    const result = await db.rpc("submit_weekly_ticket",{...args,p_legs:checked});
    if (result.error) return weeklyError(result.error);
    return json(result.data);
  }

  return json({ error: "unknown_action" }, 400);
});
