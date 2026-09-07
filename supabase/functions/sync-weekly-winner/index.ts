import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";
import { fetchStandings } from "../_shared/standings.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return Response.json(body, {status, headers: {...cors, "Cache-Control": "no-store"}});
}
function easternClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {timeZone: "America/New_York", weekday: "short", hour: "2-digit", hour12: false}).formatToParts(date);
  return {weekday: parts.find(p=>p.type==="weekday")?.value, hour: Number(parts.find(p=>p.type==="hour")?.value)};
}
Deno.serve(async (req: Request) => {
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({error:"method_not_allowed"},405);
  const body=await req.json().catch(()=>null);
  if(body?.scheduled!==true) return json({error:"scheduled_sync_only"},403);
  const clock=easternClock();
  if(clock.weekday!=="Tue" || clock.hour!==9) return json({ok:true,skipped:"outside_tuesday_9am_et_window"});
  const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url || !key) return json({error:"server_not_configured"},503);
  const db=createClient(url,key,{auth:{persistSession:false}});
  try {
    const {data:season,error:seasonError}=await db.from("seasons").select("id, leagues!inner(name)").eq("year",2026).eq("leagues.name","DU Shamers").single();
    if(seasonError || !season) return json({error:"season_lookup_failed"},503);
    // The public scheduler key is not an identity. A DB lease and cooldown bound all callers.
    const {data:lease,error:leaseError}=await db.rpc("begin_weekly_sync",{p_season:season.id});
    if(leaseError) return json({error:"sync_reservation_failed"},503);
    if(lease?.skipped) return json({ok:true,skipped:lease.skipped});
    if(!lease?.lease_id) return json({error:"sync_reservation_failed"},503);
    const payload=await fetchStandings(Deno.env.get("ESPN_S2")||"",Deno.env.get("ESPN_SWID")||Deno.env.get("SWID")||"");
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(payload)));
    const hash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
    const {data:result,error}=await db.rpc("finish_weekly_sync",{p_season:season.id,p_lease:lease.lease_id,p_hash:hash,p_payload:payload});
    if(error) return json({error:"sync_save_failed"},503);
    return json(result,result?.skipped==="scores_not_finalized"?409:200);
  } catch(error) {
    const code=error instanceof Error && error.message==="espn_credentials_not_configured" ? error.message : "espn_sync_failed";
    return json({error:code},503);
  }
});
