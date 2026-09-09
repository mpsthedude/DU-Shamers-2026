import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { ticketProgress } from "../_shared/tracker.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: cors });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return Response.json({ error: "server_not_configured" }, { status: 500, headers: cors });
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: season, error: seasonError } = await db.from("seasons").select("id, year, starting_pool_cents, prize_reserve_cents, futures_budget_cents, weekly_budget_cents, weekly_award_cents, weekly_award_count, leagues!inner(name, execution_book, timezone)").eq("year", 2026).eq("leagues.name", "DU Shamers").single();
  if (seasonError) {
    console.error("dashboard_season_query_failed", { code: seasonError.code });
    return Response.json({ error: "season_lookup_failed" }, { status: 503, headers: cors });
  }
  if (!season) return Response.json({ error: "season_not_found" }, { status: 404, headers: cors });

  const [awardsResult, betsResult, ledgerResult] = await Promise.all([
    db.from("weekly_awards").select("week, fantasy_team_id, fantasy_team_name, score, award_basis, source_status, requires_commissioner_resolution, identified_at").eq("season_id", season.id).order("week", { ascending: false }),
    db.from("bets").select("id, category, sportsbook, description, market_label, stake_cents, placed_american_odds, potential_return_cents, status, placed_at, settled_at, settlement_return_cents, bet_legs(selection, market_name, sport)").eq("season_id", season.id).order("placed_at", { ascending: false }),
    db.from("ledger_transactions").select("account, transaction_type, amount_cents, description, occurred_at").eq("season_id", season.id).order("occurred_at", { ascending: false }),
  ]);
  if (awardsResult.error || betsResult.error || ledgerResult.error) return Response.json({ error: "dashboard_read_failed" }, { status: 500, headers: cors });

  const ledger = ledgerResult.data || [];
  const bonusBankCents = ledger.filter((row: any) => row.account === "BONUS_BANK").reduce((sum: number, row: any) => sum + Number(row.amount_cents || 0), 0);
  const weeklySpentCents = Math.abs(ledger.filter((row: any) => row.account === "WEEKLY_ALLOCATION" && Number(row.amount_cents) < 0).reduce((sum: number, row: any) => sum + Number(row.amount_cents || 0), 0));
  const futuresSpentCents = Math.abs(ledger.filter((row: any) => row.account === "FUTURES_ALLOCATION" && Number(row.amount_cents) < 0).reduce((sum: number, row: any) => sum + Number(row.amount_cents || 0), 0));
  const cashPaidCents = Math.abs(ledger.filter((row: any) => row.account === "CASH_PAYOUTS" && Number(row.amount_cents) < 0).reduce((sum: number, row: any) => sum + Number(row.amount_cents || 0), 0));

  const [snapshotResult, earningsResult, editionsResult] = await Promise.all([
    db.from("league_standings_snapshots").select("id,source_hash,observed_at,payload").eq("season_id",season.id).order("observed_at",{ascending:false}).limit(1).maybeSingle(),
    db.rpc("league_team_earnings",{p_season:season.id}),
    db.from("weekly_editions").select("id,week,revision,facts,entries,published_at").eq("season_id",season.id).eq("status","PUBLISHED").order("week",{ascending:false}).limit(18),
  ]);
  const snapshot=snapshotResult.data;
  const standings = snapshotResult.error || !snapshot ? null : {
    ...snapshot.payload,snapshot_id:snapshot.id,source_hash:snapshot.source_hash,observed_at:snapshot.observed_at,
    stale:Date.now()-new Date(snapshot.observed_at).getTime()>86400000,
    earnings:earningsResult.error?null:earningsResult.data,
  };
  const trackerResult=await db.rpc('tracker_ticket_data',{p_season:season.id});
  const [futuresHistory,futuresMappings,futuresPolicy]=await Promise.all([
    db.from('futures_odds_history').select('bet_id,week,snapshot_date,american_odds,observed_at').order('snapshot_date'),
    db.from('futures_feed_mapping').select('bet_id'),
    db.from('futures_feed_policy').select('enabled').eq('singleton',true).single(),
  ]);
  return Response.json({
    weekly_tracker:trackerResult.error?null:ticketProgress(trackerResult.data||[]),
    editions:editionsResult.error?null:(editionsResult.data||[]).map((e:any)=>{
      const scores=snapshot?.payload?.completed_weeks?.find((w:any)=>w.week===e.week)?.scores;
      const teams=snapshot?.payload?.teams||[];
      return {...e,source_changed:!scores || e.facts.some((f:any)=>scores.find((s:any)=>s.team_id===f.team_id)?.score!==f.score
        || teams.find((t:any)=>t.team_id===f.team_id)?.team_name!==f.team_name)};
    }),
    standings,
    league: { name: "DU Shamers", espn_league_id: 290466, execution_book: "draftkings", timezone: "America/New_York" },
    season: {
      year: season.year,
      starting_pool_cents: season.starting_pool_cents,
      prize_reserve_cents: season.prize_reserve_cents,
      futures_budget_cents: season.futures_budget_cents,
      weekly_budget_cents: season.weekly_budget_cents,
      weekly_award_cents: season.weekly_award_cents,
      weekly_award_count: season.weekly_award_count,
      weekly_spent_cents: weeklySpentCents,
      weekly_remaining_cents: Math.max(0, season.weekly_budget_cents - weeklySpentCents - cashPaidCents),
      futures_spent_cents: futuresSpentCents,
      futures_remaining_cents: Math.max(0, season.futures_budget_cents - futuresSpentCents),
      cash_payouts_cents: cashPaidCents,
    },
    current_award: awardsResult.data?.[0] ?? null,
    weekly_awards: awardsResult.data ?? [],
    bets: (betsResult.data ?? []).map((b:any)=>({...b,
      futures_history:futuresHistory.error?null:(futuresHistory.data||[]).filter((h:any)=>h.bet_id===b.id),
      futures_covered:futuresMappings.error?null:(futuresMappings.data||[]).some((m:any)=>m.bet_id===b.id),
      futures_automatic:futuresPolicy.data?.enabled===true,
      completed_week:Math.max(0,...(snapshot?.payload?.completed_weeks||[]).map((w:any)=>w.week)),
    })),
    ledger,
    bonus_bank_cents: bonusBankCents,
    generated_at: new Date().toISOString(),
  }, { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
});
