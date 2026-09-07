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
function submissionWindowOpen(date = new Date()) {
  const p = easternParts(date);
  if (p.weekday === "Mon") return false;
  if (p.weekday === "Sun" && (p.hour > 11 || (p.hour === 11 && p.minute >= 0))) return false;
  return true;
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
function american(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value !== 0) return Math.trunc(value);
  if (typeof value !== "string") return null;
  const parsed = Number(value.trim().replace("+", ""));
  return Number.isFinite(parsed) && parsed !== 0 ? Math.trunc(parsed) : null;
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
  const { data: award } = await db.from("weekly_awards").select("id,week,fantasy_team_id,fantasy_team_name,score,source_status,identified_at").eq("season_id", season.id).order("week", { ascending: false }).limit(1).maybeSingle();
  return { season, award };
}
async function validateLiveLegs(legs: any[]) {
  const apiKey = Deno.env.get("SPORTSGAMEODDS_API_KEY");
  if (!apiKey) throw new Error("sportsgameodds_not_configured");
  const grouped = new Map<string, any[]>();
  for (const leg of legs) {
    const id = String(leg.event_id);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id)!.push(leg);
  }
  const checked: any[] = [];
  for (const [eventId, eventLegs] of grouped) {
    const oddIds = [...new Set(eventLegs.map((leg) => String(leg.odd_id)))];
    const params = new URLSearchParams({ eventID: eventId, oddsAvailable: "true", bookmakerID: "draftkings", oddID: oddIds.join(","), includeAltLines: "false", limit: "1" });
    const response = await fetch(`${SGO_URL}?${params.toString()}`, { headers: { "x-api-key": apiKey, Accept: "application/json" } });
    if (!response.ok) throw new Error(`sportsgameodds_http_${response.status}`);
    const payload = await response.json();
    const event = Array.isArray(payload?.data) ? payload.data[0] : null;
    if (!event) throw new Error("event_unavailable");
    const startsAt = event?.status?.startsAt ? new Date(event.status.startsAt) : null;
    if (!startsAt || Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) throw new Error("event_already_started");
    for (const leg of eventLegs) {
      const odd = event?.odds?.[leg.odd_id];
      const book = odd?.byBookmaker?.draftkings;
      if (!odd || !book || book.available !== true || american(book.odds) === null) throw new Error("selection_unavailable");
      checked.push({ ...leg, current_odds: american(book.odds), event_start_at: startsAt.toISOString(), observed_at: new Date().toISOString() });
    }
  }
  return checked;
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
      submission_window_open: submissionWindowOpen(),
      team_directory: teams.map((team) => ({ ...team, claimed: occupiedIds.has(team.team_id), pending_claim: pendingIds.has(team.team_id) })),
      current_proposal: proposal,
    });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => ({}));
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
    if (!membership?.id || !membership?.fantasy_team_id) return json({ error: "approved_team_membership_required" }, 403);
    const { season, award } = await currentSeasonAndAward(db, league.id);
    if (!season || !award || award.source_status !== "WINNER_IDENTIFIED") return json({ error: "weekly_winner_not_ready" }, 409);
    if (String(award.fantasy_team_id) !== String(membership.fantasy_team_id)) return json({ error: "not_this_weeks_high_scorer" }, 403);
    if (!submissionWindowOpen()) return json({ error: "weekly_submission_window_closed" }, 409);

    const choice = body?.choice === "ride" || body?.choice === "LET_IT_RIDE_100" ? "LET_IT_RIDE_100" : body?.choice === "split" || body?.choice === "SPLIT_50_50" ? "SPLIT_50_50" : null;
    if (!choice) return json({ error: "invalid_weekly_choice" }, 400);
    const cashCents = choice === "SPLIT_50_50" ? 5000 : 0;
    const wagerCents = choice === "SPLIT_50_50" ? 5000 : 10000;
    const legs = Array.isArray(body?.legs) ? body.legs.slice(0, 12) : [];
    if (!legs.length || legs.length > 12) return json({ error: "legs_required" }, 400);
    for (const leg of legs) {
      if (!leg?.event_id || !leg?.odd_id || !["NFL","NCAAF"].includes(String(leg.sport))) return json({ error: "invalid_leg" }, 400);
    }
    let checked;
    try { checked = await validateLiveLegs(legs); }
    catch (error) { return json({ error: error instanceof Error ? error.message : "selection_validation_failed" }, 409); }

    const { data: existingDecision } = await db.from("weekly_decisions").select("id,member_id,choice,wager_budget_cents").eq("weekly_award_id", award.id).maybeSingle();
    if (existingDecision && (existingDecision.member_id !== membership.id || existingDecision.choice !== choice)) return json({ error: "weekly_decision_already_locked" }, 409);
    let decision = existingDecision;
    if (!decision) {
      const { data, error } = await db.from("weekly_decisions").insert({ weekly_award_id: award.id, member_id: membership.id, choice, cash_payout_cents: cashCents, wager_budget_cents: wagerCents }).select("id,member_id,choice,wager_budget_cents").single();
      if (error || !data) return json({ error: "weekly_decision_create_failed" }, 500);
      decision = data;
      if (cashCents > 0) await db.from("ledger_transactions").insert({ season_id: season.id, account: "CASH_PAYOUTS", transaction_type: "WEEKLY_HIGH_SCORE_CASH", amount_cents: -cashCents, weekly_award_id: award.id, description: `Week ${award.week} high-score cash payout`, occurred_at: new Date().toISOString(), created_by: user.id });
    }
    const { data: existingProposal } = await db.from("bet_proposals").select("id,status").eq("weekly_decision_id", decision.id).in("status", ["SUBMITTED","AWAITING_COMMISSIONER_PLACEMENT","PLACED"]).maybeSingle();
    if (existingProposal) return json({ error: "weekly_ticket_already_submitted", proposal_id: existingProposal.id, status: existingProposal.status }, 409);

    const sports = [...new Set(checked.map((leg: any) => String(leg.sport)))];
    const proposalSport = sports.length === 1 ? sports[0] : "FOOTBALL";
    const firstStart = checked.map((leg: any) => new Date(leg.event_start_at).getTime()).sort((a: number,b: number) => a-b)[0];
    const hardDeadline = weeklyHardDeadline();
    const estimatedOdds = american(body?.estimated_american_odds);
    const estimatedReturnCents = Number.isInteger(body?.estimated_return_cents) ? body.estimated_return_cents : null;
    const now = new Date().toISOString();
    const { data: proposal, error: proposalError } = await db.from("bet_proposals").insert({
      season_id: season.id, weekly_decision_id: decision.id, submitted_by: membership.id, category: "WEEKLY", sport: proposalSport,
      execution_book: "draftkings", proposed_stake_cents: wagerCents, estimated_american_odds: estimatedOdds, estimated_return_cents: estimatedReturnCents,
      status: "AWAITING_COMMISSIONER_PLACEMENT", first_event_start_at: new Date(firstStart).toISOString(), hard_deadline_at: hardDeadline.toISOString(), submitted_at: now,
    }).select("id,status,proposed_stake_cents,submitted_at").single();
    if (proposalError || !proposal) return json({ error: "proposal_create_failed" }, 500);

    const legRows = checked.map((leg: any, index: number) => ({
      proposal_id: proposal.id, provider: "sportsgameodds", bookmaker: "draftkings", sport: String(leg.sport), event_id: String(leg.event_id), market_id: leg.market_id || null,
      odd_id: String(leg.odd_id), event_name: String(leg.event_name || leg.event_id), market_name: String(leg.market || "Market"), selection: String(leg.selection || leg.odd_id),
      american_odds: leg.current_odds, event_start_at: leg.event_start_at, observed_at: leg.observed_at, sort_order: index,
    }));
    const { error: legsError } = await db.from("bet_proposal_legs").insert(legRows);
    if (legsError) {
      await db.from("bet_proposals").delete().eq("id", proposal.id);
      return json({ error: "proposal_legs_create_failed" }, 500);
    }
    return json({ ok: true, proposal, choice, cash_payout_cents: cashCents, wager_budget_cents: wagerCents });
  }

  return json({ error: "unknown_action" }, 400);
});
