import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ESPN_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
const LEAGUE_ID = 290466;
const YEAR = 2026;
const LAST_WEEKLY_AWARD_WEEK = 14;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function teamName(team: any): string {
  if (typeof team?.name === "string" && team.name.trim()) return team.name.trim();
  return `${team?.location ?? "Unknown"} ${team?.nickname ?? "Unknown"}`.trim();
}
function easternClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: get("weekday"), hour: Number(get("hour")), minute: Number(get("minute")) };
}
async function espnFetch(path: string, params: URLSearchParams, fantasyFilter?: unknown) {
  const espnS2 = Deno.env.get("ESPN_S2");
  const swid = Deno.env.get("ESPN_SWID") || Deno.env.get("SWID");
  if (!espnS2 || !swid) throw new Error("espn_credentials_not_configured");
  const headers: Record<string,string> = { "Accept": "application/json", "User-Agent": "du-shamers-league-bank/1.0", "Cookie": `espn_s2=${espnS2}; SWID=${swid}` };
  if (fantasyFilter) headers["x-fantasy-filter"] = JSON.stringify(fantasyFilter);
  const response = await fetch(`${ESPN_BASE}${path}?${params.toString()}`, { headers });
  if (!response.ok) throw new Error(`espn_http_${response.status}`);
  const payload = await response.json();
  if (!payload || typeof payload !== "object") throw new Error("espn_invalid_payload");
  return payload;
}
function validWeeks(payload: any): number[] {
  const periods = payload?.settings?.scheduleSettings?.matchupPeriods;
  const weeks = new Set<number>();
  if (periods && typeof periods === "object") {
    for (const values of Object.values(periods)) if (Array.isArray(values)) for (const v of values) if (Number.isInteger(v) && (v as number) >= 1) weeks.add(v as number);
  }
  if (!weeks.size) {
    const first = payload?.status?.firstScoringPeriod ?? 1;
    const final = payload?.status?.finalScoringPeriod;
    if (Number.isInteger(first) && Number.isInteger(final)) for (let w = first; w <= final; w++) weeks.add(w);
  }
  return [...weeks].sort((a,b) => a-b);
}
function matchupPeriodForWeek(payload: any, week: number): number {
  const periods = payload?.settings?.scheduleSettings?.matchupPeriods;
  if (periods && typeof periods === "object") {
    for (const [periodId, values] of Object.entries(periods)) if (Array.isArray(values) && values.includes(week)) return Number(periodId) || week;
  }
  return week;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  if (body?.scheduled !== true) return json({ error: "scheduled_sync_only" }, 403);
  const clock = easternClock();
  if (clock.weekday !== "Tue" || clock.hour !== 9) return json({ ok: true, skipped: "outside_tuesday_9am_et_window", local_clock: clock });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "server_not_configured" }, 500);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const contextParams = new URLSearchParams();
    for (const view of ["mSettings","mTeam","mMatchupScore"]) contextParams.append("view", view);
    const context = await espnFetch(`/seasons/${YEAR}/segments/0/leagues/${LEAGUE_ID}`, contextParams);
    const valid = validWeeks(context);
    const scoringPeriod = Number(context?.scoringPeriodId || 0);
    const week = scoringPeriod > 1 ? scoringPeriod - 1 : null;
    if (week === null) return json({ ok: true, skipped: "no_completed_scoring_week_yet", scoring_period: scoringPeriod });
    if (!valid.includes(week)) return json({ error: "invalid_week", week, valid_weeks: valid }, 400);
    if (week > LAST_WEEKLY_AWARD_WEEK) return json({ ok: true, skipped: "weekly_award_program_complete", week, last_week: LAST_WEEKLY_AWARD_WEEK });

    const matchupPeriod = matchupPeriodForWeek(context, week);
    const scoreParams = new URLSearchParams();
    for (const view of ["mTeam","mMatchupScore","mScoreboard"]) scoreParams.append("view", view);
    scoreParams.append("scoringPeriodId", String(week));
    const scoreboard = await espnFetch(`/seasons/${YEAR}/segments/0/leagues/${LEAGUE_ID}`, scoreParams, { schedule: { filterMatchupPeriodIds: { value: [matchupPeriod] } } });

    const teamsById = new Map<number,string>();
    for (const t of Array.isArray(scoreboard?.teams) ? scoreboard.teams : []) if (Number.isInteger(t?.id)) teamsById.set(t.id, teamName(t));
    const scores: {team_id:number, team_name:string, score:number}[] = [];
    for (const matchup of Array.isArray(scoreboard?.schedule) ? scoreboard.schedule : []) {
      for (const side of [matchup?.home, matchup?.away]) {
        const id = side?.teamId;
        if (!Number.isInteger(id)) continue;
        const score = Number(side?.totalPoints ?? 0);
        scores.push({ team_id: id, team_name: teamsById.get(id) ?? `Team ${id}`, score: Number.isFinite(score) ? score : 0 });
      }
    }
    if (!scores.length) return json({ ok: true, skipped: "no_scores_found", week });
    const high = Math.max(...scores.map(s => s.score));
    if (high <= 0) return json({ ok: true, skipped: "scores_not_finalized", week });
    const winners = scores.filter(s => s.score === high);
    const tie = winners.length > 1;

    const { data: season, error: seasonError } = await db.from("seasons").select("id, leagues!inner(name)").eq("year", YEAR).eq("leagues.name", "DU Shamers").single();
    if (seasonError || !season) return json({ error: "season_not_found" }, 500);

    const now = new Date().toISOString();
    const award = {
      season_id: season.id,
      week,
      fantasy_team_id: tie ? null : String(winners[0].team_id),
      fantasy_team_name: tie ? null : winners[0].team_name,
      score: high,
      source_status: tie ? "COMMISSIONER_RESOLUTION_REQUIRED" : "WINNER_IDENTIFIED",
      requires_commissioner_resolution: tie,
      identified_at: now,
      source_observed_at: now,
      source_payload: { espn_league_id: LEAGUE_ID, year: YEAR, week, matchup_period: matchupPeriod, scores, winners },
    };
    const { error: upsertError } = await db.from("weekly_awards").upsert(award, { onConflict: "season_id,week" });
    if (upsertError) return json({ error: "award_upsert_failed" }, 500);
    return json({ ok: true, league_id: LEAGUE_ID, year: YEAR, week, tie, high_score: high, winner: tie ? null : winners[0], tied_winners: tie ? winners : [], scores, synced_at: now });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const safe = message.startsWith("espn_http_") || message === "espn_credentials_not_configured" || message === "espn_invalid_payload" ? message : "sync_failed";
    return json({ error: safe }, safe === "espn_credentials_not_configured" ? 503 : 500);
  }
});
