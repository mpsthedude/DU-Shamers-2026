import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const LEAGUE_NAME = "DU Shamers";
const YEAR = 2026;
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
function bearer(req: Request) { const raw = req.headers.get("authorization") || ""; return raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : ""; }
function american(value: unknown): number | null { if (typeof value === "number" && Number.isFinite(value) && value !== 0) return Math.trunc(value); if (typeof value !== "string") return null; const parsed = Number(value.trim().replace("+", "")); return Number.isFinite(parsed) && parsed !== 0 ? Math.trunc(parsed) : null; }
function totalReturnCents(stake: number, odds: number) { const decimal = odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds); return Math.round(stake * decimal); }
async function context(req: Request) {
  const url = Deno.env.get("SUPABASE_URL"); const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!url || !serviceKey) return { error: json({ error: "server_not_configured" }, 500) } as any;
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const token = bearer(req); if (!token || token.startsWith("sb_publishable_")) return { error: json({ error: "commissioner_sign_in_required" }, 401) } as any;
  const { data: userData, error: userError } = await db.auth.getUser(token); const user = userData?.user;
  if (userError || !user?.id || !user.email) return { error: json({ error: "commissioner_sign_in_required" }, 401) } as any;
  await db.from("profiles").upsert({ id: user.id, display_name: user.user_metadata?.display_name || user.email.split("@")[0] }, { onConflict: "id", ignoreDuplicates: true });
  const { data: league } = await db.from("leagues").select("id,name").eq("name", LEAGUE_NAME).single(); if (!league) return { error: json({ error: "league_not_found" }, 500) } as any;
  const { data: allowed } = await db.from("commissioner_allowlist").select("id").eq("league_id", league.id).eq("email", user.email.toLowerCase()).maybeSingle();
  if (!allowed) return { error: json({ error: "commissioner_not_authorized" }, 403) } as any;
  const { data: member } = await db.from("league_members").select("id,role,fantasy_team_id,fantasy_team_name").eq("league_id", league.id).eq("profile_id", user.id).maybeSingle();
  if (!member) await db.from("league_members").insert({ league_id: league.id, profile_id: user.id, role: "COMMISSIONER" });
  else if (member.role !== "COMMISSIONER") await db.from("league_members").update({ role: "COMMISSIONER" }).eq("id", member.id);
  const { data: commissioner } = await db.from("league_members").select("id,role,fantasy_team_id,fantasy_team_name").eq("league_id", league.id).eq("profile_id", user.id).single();
  const { data: season } = await db.from("seasons").select("id").eq("league_id", league.id).eq("year", YEAR).single();
  if (!season) return { error: json({ error: "season_not_found" }, 500) } as any;
  return { db, user, league, commissioner, season };
}
async function namesByProfile(db: any, ids: string[]) {
  if (!ids.length) return new Map<string,string>();
  const { data } = await db.from("profiles").select("id,display_name").in("id", [...new Set(ids)]);
  return new Map((data || []).map((row: any) => [row.id, row.display_name]));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const ctx: any = await context(req); if (ctx.error) return ctx.error;
  const { db, user, league, commissioner, season } = ctx;

  if (req.method === "GET") {
    const [claimsResult, proposalsResult, betsResult] = await Promise.all([
      db.from("team_claims").select("id,profile_id,fantasy_team_id,fantasy_team_name,status,requested_at,reviewed_at,review_note").eq("league_id", league.id).order("requested_at", { ascending: false }),
      db.from("bet_proposals").select("id,weekly_decision_id,submitted_by,category,sport,execution_book,proposed_stake_cents,estimated_american_odds,estimated_return_cents,status,first_event_start_at,hard_deadline_at,submitted_at,created_at").eq("season_id", season.id).order("created_at", { ascending: false }),
      db.from("bets").select("id,proposal_id,category,sportsbook,stake_cents,placed_american_odds,potential_return_cents,status,sportsbook_ticket_ref,placed_at,settled_at,settlement_return_cents").eq("season_id", season.id).order("placed_at", { ascending: false }),
    ]);
    if (claimsResult.error || proposalsResult.error || betsResult.error) return json({ error: "commissioner_read_failed" }, 500);
    const proposalIds = (proposalsResult.data || []).map((p: any) => p.id);
    const { data: proposalLegs } = proposalIds.length ? await db.from("bet_proposal_legs").select("id,proposal_id,sport,event_id,odd_id,event_name,market_name,selection,american_odds,event_start_at,observed_at,sort_order").in("proposal_id", proposalIds).order("sort_order") : { data: [] as any[] };
    const memberIds = (proposalsResult.data || []).map((p: any) => p.submitted_by).filter(Boolean);
    const { data: submitters } = memberIds.length ? await db.from("league_members").select("id,profile_id,fantasy_team_id,fantasy_team_name").in("id", memberIds) : { data: [] as any[] };
    const profileIds = [...(claimsResult.data || []).map((c: any) => c.profile_id), ...(submitters || []).map((m: any) => m.profile_id)].filter(Boolean);
    const profileNames = await namesByProfile(db, profileIds);
    const submitterMap = new Map((submitters || []).map((m: any) => [m.id, { ...m, display_name: profileNames.get(m.profile_id) || "League member" }]));
    const legsByProposal = new Map<string,any[]>();
    for (const leg of proposalLegs || []) { if (!legsByProposal.has(leg.proposal_id)) legsByProposal.set(leg.proposal_id, []); legsByProposal.get(leg.proposal_id)!.push(leg); }
    return json({
      commissioner,
      claims: (claimsResult.data || []).map((c: any) => ({ ...c, display_name: profileNames.get(c.profile_id) || "League member" })),
      proposals: (proposalsResult.data || []).map((p: any) => ({ ...p, submitter: submitterMap.get(p.submitted_by) || null, legs: legsByProposal.get(p.id) || [] })),
      bets: betsResult.data || [],
    });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => ({})); const action = body?.action;

  if (action === "approve_claim") {
    const claimId = String(body?.claim_id || ""); if (!claimId) return json({ error: "claim_id_required" }, 400);
    const { data: claim } = await db.from("team_claims").select("id,profile_id,fantasy_team_id,fantasy_team_name,status").eq("id", claimId).eq("league_id", league.id).single();
    if (!claim || claim.status !== "PENDING") return json({ error: "pending_claim_not_found" }, 404);
    const { data: occupied } = await db.from("league_members").select("id,profile_id").eq("league_id", league.id).eq("fantasy_team_id", claim.fantasy_team_id).maybeSingle();
    if (occupied && occupied.profile_id !== claim.profile_id) return json({ error: "team_already_assigned" }, 409);
    const { data: existing } = await db.from("league_members").select("id,role").eq("league_id", league.id).eq("profile_id", claim.profile_id).maybeSingle();
    if (existing) {
      const { error } = await db.from("league_members").update({ fantasy_team_id: claim.fantasy_team_id, fantasy_team_name: claim.fantasy_team_name }).eq("id", existing.id); if (error) return json({ error: "membership_update_failed" }, 500);
    } else {
      const { error } = await db.from("league_members").insert({ league_id: league.id, profile_id: claim.profile_id, fantasy_team_id: claim.fantasy_team_id, fantasy_team_name: claim.fantasy_team_name, role: "OWNER" }); if (error) return json({ error: "membership_create_failed" }, 500);
    }
    await db.from("team_claims").update({ status: "APPROVED", reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_note: body?.note || null }).eq("id", claim.id);
    return json({ ok: true, status: "APPROVED", claim_id: claim.id });
  }

  if (action === "reject_claim") {
    const claimId = String(body?.claim_id || ""); if (!claimId) return json({ error: "claim_id_required" }, 400);
    const { error } = await db.from("team_claims").update({ status: "REJECTED", reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_note: body?.note || null }).eq("id", claimId).eq("league_id", league.id).eq("status", "PENDING");
    if (error) return json({ error: "claim_reject_failed" }, 500); return json({ ok: true, status: "REJECTED" });
  }

  if (action === "reject_proposal") {
    const proposalId = String(body?.proposal_id || ""); if (!proposalId) return json({ error: "proposal_id_required" }, 400);
    const { error } = await db.from("bet_proposals").update({ status: "REJECTED" }).eq("id", proposalId).eq("season_id", season.id).eq("status", "AWAITING_COMMISSIONER_PLACEMENT");
    if (error) return json({ error: "proposal_reject_failed" }, 500); return json({ ok: true, status: "REJECTED" });
  }

  if (action === "confirm_placement") {
    const proposalId = String(body?.proposal_id || ""); const placedOdds = american(body?.placed_american_odds);
    if (!proposalId || placedOdds === null) return json({ error: "proposal_id_and_actual_odds_required" }, 400);
    const { data: proposal } = await db.from("bet_proposals").select("id,category,proposed_stake_cents,status").eq("id", proposalId).eq("season_id", season.id).single();
    if (!proposal || proposal.status !== "AWAITING_COMMISSIONER_PLACEMENT") return json({ error: "proposal_not_awaiting_placement" }, 409);
    const { data: existingBet } = await db.from("bets").select("id").eq("proposal_id", proposal.id).maybeSingle(); if (existingBet) return json({ error: "proposal_already_placed", bet_id: existingBet.id }, 409);
    const stake = proposal.proposed_stake_cents; const potential = totalReturnCents(stake, placedOdds); const placedAt = body?.placed_at ? new Date(body.placed_at) : new Date();
    if (Number.isNaN(placedAt.getTime())) return json({ error: "invalid_placed_at" }, 400);
    const { data: bet, error: betError } = await db.from("bets").insert({ season_id: season.id, proposal_id: proposal.id, category: proposal.category, sportsbook: "draftkings", stake_cents: stake, placed_american_odds: placedOdds, potential_return_cents: potential, status: "OPEN", sportsbook_ticket_ref: body?.sportsbook_ticket_ref || null, placed_at: placedAt.toISOString() }).select("id,status,stake_cents,placed_american_odds,potential_return_cents,placed_at").single();
    if (betError || !bet) return json({ error: "bet_record_create_failed" }, 500);
    const { data: proposalLegs } = await db.from("bet_proposal_legs").select("sport,event_id,market_id,odd_id,event_name,market_name,selection,american_odds,event_start_at,sort_order").eq("proposal_id", proposal.id).order("sort_order");
    const legRows = (proposalLegs || []).map((leg: any) => ({ bet_id: bet.id, provider: "sportsgameodds", bookmaker: "draftkings", sport: leg.sport, event_id: leg.event_id, market_id: leg.market_id, odd_id: leg.odd_id, event_name: leg.event_name, market_name: leg.market_name, selection: leg.selection, ticket_american_odds: leg.american_odds, event_start_at: leg.event_start_at, status: "UPCOMING", sort_order: leg.sort_order }));
    if (legRows.length) { const { error: legsError } = await db.from("bet_legs").insert(legRows); if (legsError) { await db.from("bets").delete().eq("id", bet.id); return json({ error: "bet_legs_create_failed" }, 500); } }
    await db.from("bet_proposals").update({ status: "PLACED" }).eq("id", proposal.id);
    const account = proposal.category === "FUTURE" ? "FUTURES_ALLOCATION" : proposal.category === "SUPER_BOWL" ? "BONUS_BANK" : "WEEKLY_ALLOCATION";
    await db.from("ledger_transactions").insert({ season_id: season.id, account, transaction_type: "BET_PLACED", amount_cents: -stake, bet_id: bet.id, description: `${proposal.category === "WEEKLY" ? "Weekly" : proposal.category} DraftKings wager placed`, occurred_at: placedAt.toISOString(), created_by: user.id, metadata: { placed_american_odds: placedOdds, sportsbook_ticket_ref: body?.sportsbook_ticket_ref || null } });
    return json({ ok: true, bet });
  }

  if (action === "settle_bet") {
    const betId = String(body?.bet_id || ""); const status = String(body?.status || "").toUpperCase();
    if (!betId || !["WON","LOST","PUSHED","VOID"].includes(status)) return json({ error: "valid_bet_id_and_status_required" }, 400);
    const { data: bet } = await db.from("bets").select("id,stake_cents,status,category").eq("id", betId).eq("season_id", season.id).single(); if (!bet) return json({ error: "bet_not_found" }, 404); if (bet.status !== "OPEN") return json({ error: "bet_already_settled" }, 409);
    let settlementReturn = Number(body?.settlement_return_cents);
    if (status === "LOST") settlementReturn = 0;
    if ((status === "PUSHED" || status === "VOID") && !Number.isInteger(settlementReturn)) settlementReturn = bet.stake_cents;
    if (status === "WON" && (!Number.isInteger(settlementReturn) || settlementReturn <= 0)) return json({ error: "winning_return_required" }, 400);
    if (!Number.isInteger(settlementReturn) || settlementReturn < 0) return json({ error: "invalid_settlement_return" }, 400);
    const settledAt = new Date();
    const { error: updateError } = await db.from("bets").update({ status, settled_at: settledAt.toISOString(), settlement_return_cents: settlementReturn }).eq("id", bet.id); if (updateError) return json({ error: "bet_settlement_failed" }, 500);
    if (settlementReturn > 0) await db.from("ledger_transactions").insert({ season_id: season.id, account: "BONUS_BANK", transaction_type: "BET_SETTLEMENT_RETURN", amount_cents: settlementReturn, bet_id: bet.id, description: `${status} DraftKings wager return`, occurred_at: settledAt.toISOString(), created_by: user.id, metadata: { settlement_status: status } });
    return json({ ok: true, bet_id: bet.id, status, settlement_return_cents: settlementReturn });
  }

  return json({ error: "unknown_action" }, 400);
});
