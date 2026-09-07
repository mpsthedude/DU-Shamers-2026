import { fetchStandings } from "../_shared/standings.ts";
import { draftEdition } from "../_shared/editions.ts";
import { verifiedOwner } from "../_shared/owners.ts";
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
function american(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^[+-]?\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && Math.abs(parsed) >= 100 ? parsed : null;
}
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
  const owner=await verifiedOwner(db,user,league.id);
  if(owner.error) return {error:json({error:owner.error},403)} as any;
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
  const ctx: any = await context(req); if (ctx.error) return ctx.error;
  const { db, user, league, commissioner, season } = ctx;

  if (req.method === "GET") {
    const [claimsResult, proposalsResult, betsResult, ownersResult] = await Promise.all([
      db.from("team_claims").select("id,profile_id,fantasy_team_id,fantasy_team_name,status,requested_at,reviewed_at,review_note").eq("league_id", league.id).order("requested_at", { ascending: false }),
      db.from("bet_proposals").select("id,weekly_decision_id,submitted_by,category,sport,execution_book,proposed_stake_cents,estimated_american_odds,estimated_return_cents,status,first_event_start_at,hard_deadline_at,submitted_at,created_at").eq("season_id", season.id).order("created_at", { ascending: false }),
      db.from("bets").select("id,proposal_id,category,sportsbook,stake_cents,placed_american_odds,potential_return_cents,status,sportsbook_ticket_ref,placed_at,settled_at,settlement_return_cents").eq("season_id", season.id).order("placed_at", { ascending: false }),
      db.from("league_owner_directory").select("id,fantasy_team_id,team_name_at_import,manager_name,email,invite_status,invite_sent_at").eq("league_id",league.id).eq("active",true).order("manager_name"),
    ]);
    if (claimsResult.error || proposalsResult.error || betsResult.error || ownersResult.error) return json({ error: "commissioner_read_failed" }, 500);
    const proposalIds = (proposalsResult.data || []).map((p: any) => p.id);
    const { data: proposalLegs } = proposalIds.length ? await db.from("bet_proposal_legs").select("id,proposal_id,sport,event_id,odd_id,event_name,market_name,selection,american_odds,event_start_at,observed_at,sort_order").in("proposal_id", proposalIds).order("sort_order") : { data: [] as any[] };
    const memberIds = (proposalsResult.data || []).map((p: any) => p.submitted_by).filter(Boolean);
    const { data: submitters } = memberIds.length ? await db.from("league_members").select("id,profile_id,fantasy_team_id,fantasy_team_name").in("id", memberIds) : { data: [] as any[] };
    const profileIds = [...(claimsResult.data || []).map((c: any) => c.profile_id), ...(submitters || []).map((m: any) => m.profile_id)].filter(Boolean);
    const profileNames = await namesByProfile(db, profileIds);
    const submitterMap = new Map((submitters || []).map((m: any) => [m.id, { ...m, display_name: profileNames.get(m.profile_id) || "League member" }]));
    const legsByProposal = new Map<string,any[]>();
    for (const leg of proposalLegs || []) { if (!legsByProposal.has(leg.proposal_id)) legsByProposal.set(leg.proposal_id, []); legsByProposal.get(leg.proposal_id)!.push(leg); }
    const {data:providerBudget,error:budgetError}=await db.rpc("provider_budget_status");
    if(budgetError) return json({error:"provider_budget_read_failed"},500);
    const [integrationSettings,analysisSettings,objectSettings,trackerSettings]=await Promise.all([
      db.from('integration_budget').select('*').eq('singleton',true).single(),
      db.from('analysis_policy').select('*').eq('singleton',true).single(),
      db.rpc('object_budget_status'),
      db.from('tracker_policy').select('enabled,last_attempt_at,last_error').eq('singleton',true).single(),
    ]);
    if(integrationSettings.error || analysisSettings.error)return json({error:'integration_settings_unavailable'},500);
    const [editionsResult,sourceResult]=await Promise.all([
      db.from("weekly_editions").select("id,week,revision,version,facts,entries,status,published_at").eq("season_id",season.id).in("status",["DRAFT","PUBLISHED"]).order("week",{ascending:false}),
      db.from("league_standings_snapshots").select("id,payload").eq("season_id",season.id).order("observed_at",{ascending:false}).limit(1).maybeSingle(),
    ]);
    if(editionsResult.error || sourceResult.error) return json({error:"edition_read_failed"},500);
    return json({
      owners:ownersResult.data||[],
      invitations_enabled:Deno.env.get("AUTH_INVITATIONS_ENABLED")==="true",
      editions:editionsResult.data||[],
      edition_weeks:(sourceResult.data?.payload?.completed_weeks||[]).map((w:any)=>w.week).filter((w:number)=>w>=1&&w<=18),
      provider_budget:providerBudget,
      integration_budget:integrationSettings.data,
      analysis_policy:analysisSettings.data,
      object_budget:objectSettings.error?null:objectSettings.data,
      tracker_policy:trackerSettings.error?null:trackerSettings.data,
      commissioner,
      claims: (claimsResult.data || []).map((c: any) => ({ ...c, display_name: profileNames.get(c.profile_id) || "League member" })),
      proposals: (proposalsResult.data || []).map((p: any) => ({ ...p, submitter: submitterMap.get(p.submitted_by) || null, legs: legsByProposal.get(p.id) || [] })),
      bets: betsResult.data || [],
    });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await req.json().catch(() => ({})); const action = body?.action;

  if(action==='refresh_usage'){
    const {data:started,error}=await db.rpc('begin_usage_check');
    if(error)return json({error:'usage_check_recent'},409);
    try{
      const response=await fetch('https://api.sportsgameodds.com/v2/account/usage',{headers:{'x-api-key':Deno.env.get('SPORTSGAMEODDS_API_KEY')||''},redirect:'error',signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error('usage_unavailable');
      const payload=await response.json(),monthly=payload?.data?.rateLimits?.['per-month'];
      const used=monthly?.['current-entities'],limit=monthly?.['max-entities'];
      if(payload.success!==true || !Number.isSafeInteger(used) || used<0 || !Number.isSafeInteger(limit) || limit<=0)throw new Error('usage_unavailable');
      const {error:saveError}=await db.from('provider_object_policy').update({reported_used:used,reported_limit:limit,reported_at:started}).eq('singleton',true);
      if(saveError)throw new Error('usage_unavailable');
      return json({ok:true,used,limit});
    }catch{return json({error:'usage_unavailable'},503);}
  }
  if(action==='set_object_limit'){
    if(!Number.isInteger(body.limit) || body.limit<0 || body.limit>100000)return json({error:'invalid_object_limit'},400);
    const {error}=await db.from('provider_object_policy').update({monthly_limit:body.limit}).eq('singleton',true);
    return error?json({error:'object_limit_save_failed'},503):json({ok:true});
  }
  if(action==='set_tracker_enabled'){
    if(typeof body.enabled!=='boolean')return json({error:'invalid_tracker_setting'},400);
    const {error}=await db.from('tracker_policy').update({enabled:body.enabled}).eq('singleton',true);
    return error?json({error:'tracker_setting_failed'},503):json({ok:true});
  }

  if(action==="invite_owner"){
    if(Deno.env.get("AUTH_INVITATIONS_ENABLED")!=="true") return json({error:"email_delivery_not_configured"},503);
    if(typeof body.owner_id!=="string" || !/^[0-9a-f-]{36}$/i.test(body.owner_id)) return json({error:"invalid_owner_id"},400);
    const {data:reservation,error:reserveError}=await db.rpc("reserve_owner_invitation",{p_actor:user.id,p_league:league.id,p_owner:body.owner_id});
    if(reserveError) return json({error:"invitation_unavailable_or_needs_review"},409);
    if(reservation.skipped) return json({ok:true,skipped:reservation.skipped});
    let sent=false,code="invitation_delivery_unknown";
    try {
      const {error}=await db.auth.admin.inviteUserByEmail(reservation.email,{redirectTo:"https://dushamers.com/?account=setup"});
      sent=!error;code=error?.code||"invitation_delivery_failed";
      const status=sent?"SENT":error?.status>=500?"UNKNOWN":"FAILED";
      const {error:saveError}=await db.from("league_owner_directory").update({invite_status:status,invite_sent_at:sent?new Date().toISOString():null,
        invite_error:sent?null:code}).eq("id",body.owner_id).eq("league_id",league.id);
      if(saveError)return json({error:"invitation_delivery_needs_review"},503);
      return sent?json({ok:true}):json({error:"invitation_delivery_failed",code},503);
    } catch {
      await db.from("league_owner_directory").update({invite_status:"UNKNOWN",invite_error:code}).eq("id",body.owner_id).eq("league_id",league.id);
      return json({error:"invitation_delivery_needs_review"},503);
    }
  }

  if (["create_edition","save_edition","publish_edition"].includes(action)) {
    const args:any={p_actor:user.id,p_season:season.id,p_action:action==="create_edition"?"CREATE":action==="save_edition"?"SAVE":"PUBLISH"};
    if(action==="create_edition"){
      if(!Number.isInteger(body.week) || body.week<1 || body.week>18) return json({error:"edition_week_unavailable"},400);
      const {data:snapshot,error}=await db.from("league_standings_snapshots").select("id").eq("season_id",season.id).order("observed_at",{ascending:false}).limit(1).maybeSingle();
      if(error || !snapshot) return json({error:"edition_source_unavailable"},409);
      const {data:facts,error:factsError}=await db.rpc("weekly_edition_facts",{p_snapshot:snapshot.id,p_week:body.week});
      if(factsError) return json({error:"edition_week_unavailable"},409);
      try {args.p_entries=draftEdition(facts,body.week);} catch {return json({error:"invalid_edition_facts"},409);}
      args.p_week=body.week;args.p_snapshot=snapshot.id;
    } else {
      if(typeof body.edition_id!=="string" || !/^[0-9a-f-]{36}$/i.test(body.edition_id) || !Number.isInteger(body.version))
        return json({error:"invalid_edition_request"},400);
      args.p_edition=body.edition_id;args.p_version=body.version;args.p_entries=body.entries;
    }
    const {data,error}=await db.rpc("manage_weekly_edition",args);
    if(error){
      const known=new Set(["edition_source_changed","edition_week_unavailable","edition_source_unavailable","edition_not_found",
        "published_edition_is_immutable","edition_changed_reload","invalid_edition_entries","edition_numbers_belong_in_fact_line","supreme_leader_editorial_locked"]);
      return json({error:known.has(error.message)?error.message:"edition_save_failed"},409);
    }
    return json(data);
  }

  if (action === "refresh_league_standings") {
    const {data:lease,error:leaseError}=await db.rpc("begin_standings_refresh",{p_season:season.id,p_actor:user.id});
    if(leaseError) return json({error:"standings_refresh_unavailable"},409);
    if(lease.skipped) return json({ok:true,skipped:lease.skipped});
    try {
      const payload=await fetchStandings(Deno.env.get("ESPN_S2") || "",Deno.env.get("ESPN_SWID") || Deno.env.get("SWID") || "");
      const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(payload)));
      const hash=Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,"0")).join("");
      const {error}=await db.rpc("finish_standings_refresh",{p_season:season.id,p_lease:lease.lease_id,p_hash:hash,p_payload:payload});
      if(error) return json({error:"standings_save_failed"},500);
      return json({ok:true,teams:payload.teams.length,completed_weeks:payload.completed_weeks.length});
    } catch { return json({error:"espn_standings_unavailable"},503); }
  }

  if(action==='set_integration_budget'){
    const p=body.policy;
    if(!p || typeof p.enabled!=='boolean' || !Number.isSafeInteger(p.daily_microusd) || !Number.isSafeInteger(p.monthly_microusd)
      || p.daily_microusd<0 || p.monthly_microusd<0 || p.monthly_microusd>1000000000000 || p.daily_microusd>p.monthly_microusd
      || (p.enabled && p.daily_microusd===0))return json({error:'invalid_integration_budget'},400);
    const {error}=await db.from('integration_budget').update({enabled:p.enabled,daily_microusd:p.daily_microusd,monthly_microusd:p.monthly_microusd}).eq('singleton',true);
    return error?json({error:'integration_budget_update_failed'},500):json({ok:true});
  }
  if(action==='set_analysis_enabled'){
    if(typeof body.enabled!=='boolean')return json({error:'invalid_analysis_policy'},400);
    const {error}=await db.from('analysis_policy').update({enabled:body.enabled,runs_per_award:5,cooldown_seconds:0}).eq('singleton',true);
    return error?json({error:'analysis_policy_update_failed'},500):json({ok:true});
  }
  if (action === "set_provider_budget") {
    const policy=body?.policy;
    const fields=["daily_request_limit","monthly_request_limit","daily_budget_microusd","monthly_budget_microusd",
      "max_request_cost_microusd","per_user_daily_limit"];
    if(!policy || typeof policy.enabled!=="boolean" || fields.some(k=>!Number.isSafeInteger(policy[k]) || policy[k]<0 || policy[k]>1000000000000)
      || policy.daily_request_limit>100000 || policy.monthly_request_limit>1000000 || policy.per_user_daily_limit>10000)
      return json({error:"invalid_provider_budget"},400);
    if(policy.enabled && (fields.some(k=>policy[k]===0) || policy.daily_request_limit>policy.monthly_request_limit
      || policy.daily_budget_microusd>policy.monthly_budget_microusd || policy.max_request_cost_microusd>policy.daily_budget_microusd))
      return json({error:"invalid_provider_budget"},400);
    const values=Object.fromEntries(fields.map(k=>[k,policy[k]]));
    const {error}=await db.from("provider_budget").update({...values,enabled:policy.enabled,updated_at:new Date().toISOString()}).eq("provider","sportsgameodds");
    if(error) return json({error:"provider_budget_update_failed"},500);
    return json({ok:true});
  }
  if (action === "pause_provider_calls") {
    const {error}=await db.from("provider_budget").update({enabled:false,updated_at:new Date().toISOString()}).eq("provider","sportsgameodds");
    if(error) return json({error:"provider_budget_update_failed"},500);
    return json({ok:true});
  }

  if (action === "approve_claim" || action === "reject_claim") {
    const claimId = String(body?.claim_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claimId))
      return json({ error: "claim_id_required" }, 400);
    if (body?.note != null && (typeof body.note !== "string" || body.note.length > 500))
      return json({ error: "claim_note_too_long" }, 400);
    return claimResult(db, { p_actor: user.id, p_league: league.id,
      p_action: action === "approve_claim" ? "APPROVE" : "REJECT", p_claim: claimId, p_note: body?.note || null });
  }

  if (action === "reject_proposal") {
    const proposalId = String(body?.proposal_id || ""); if (!proposalId) return json({ error: "proposal_id_required" }, 400);
    const { error } = await db.from("bet_proposals").update({ status: "REJECTED" }).eq("id", proposalId).eq("season_id", season.id).eq("status", "AWAITING_COMMISSIONER_PLACEMENT");
    if (error) return json({ error: "proposal_reject_failed" }, 500); return json({ ok: true, status: "REJECTED" });
  }

  if (action === "confirm_placement" || action === "settle_bet") {
    const isPlacement = action === "confirm_placement";
    const id = String(isPlacement ? body?.proposal_id || "" : body?.bet_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return json({ error: "invalid_record_id" }, 400);
    const odds = american(body?.placed_american_odds);
    const status = String(body?.status || "").toUpperCase();
    const placedAt = body?.placed_at ? new Date(body.placed_at) : null;
    if (isPlacement && (odds === null || Math.abs(odds) < 100 || Math.abs(odds) > 2147483647)) return json({ error: "invalid_american_odds" }, 400);
    if (placedAt && Number.isNaN(placedAt.getTime())) return json({ error: "invalid_placed_at" }, 400);
    const returned = body?.settlement_return_cents ?? null;
    if (!isPlacement && returned !== null && (!Number.isInteger(returned) || returned < 0 || returned > 2147483647)) return json({ error: "invalid_settlement_return" }, 400);
    const { data, error } = isPlacement
      ? await db.rpc("record_ticket_placement", { p_actor: user.id, p_season: season.id, p_proposal: id, p_odds: odds, p_ticket_ref: body?.sportsbook_ticket_ref || null, p_placed_at: placedAt?.toISOString() || null })
      : await db.rpc("record_ticket_settlement", { p_actor: user.id, p_season: season.id, p_bet: id, p_status: status, p_return_cents: returned });
    if (error) {
      const known = new Set(["weekly_award_review_required", "invalid_american_odds", "invalid_placement_details", "season_not_found", "commissioner_not_authorized", "proposal_not_found", "placement_conflict", "proposal_not_awaiting_placement", "proposal_legs_required", "allocation_exceeded", "invalid_settlement_status", "bet_not_found", "invalid_settlement_return", "settlement_conflict"]);
      console.error("commissioner_transaction_failed", { code: error.code });
      return json({ error: known.has(error.message) ? error.message : "accounting_transaction_failed" }, known.has(error.message) ? 409 : 500);
    }
    return json(data);
  }

  return json({ error: "unknown_action" }, 400);
});
