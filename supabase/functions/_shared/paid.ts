import { createClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";

// All SGO event requests use this gate; no automatic retries or alternate providers.
export function paidHandler(handler: (req: Request, paidFetch: any) => Promise<Response>, policy: {weeklyAnalysis?:boolean,backgroundActor?:string} = {}) {
  return async (req: Request) => {
    const evidence: any[] = [];
    let db: any;
    let identity: Promise<any> | null = null;
    let analysisReservation: Promise<any> | null = null;
    function database() {
      if (!db) {
        const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!url || !key) throw new Error("paid_requests_disabled");
        db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
      }
      return db;
    }
    async function actor(allowMember: boolean) {
      // Supplied only by the fixed tracker worker after a DB lease and allowlist check.
      if(policy.backgroundActor)return policy.backgroundActor;
      if (!identity) identity=(async()=>{
        const token=(req.headers.get("authorization") || "").replace(/^Bearer\s+/i,"");
        if (!token || token.startsWith("sb_publishable_")) return null;
        const client=database();
        const {data,error}=await client.auth.getUser(token);
        if (error || !data?.user?.email) return null;
        const {data:league,error:leagueError}=await client.from("leagues").select("id").eq("name","DU Shamers").single();
        if (leagueError || !league) return null;
        const {data:allowed,error:allowError}=await client.from("commissioner_allowlist").select("id").eq("league_id",league.id)
          .eq("email",data.user.email.toLowerCase()).maybeSingle();
        const {data:member,error:memberError}=await client.from("league_members").select("fantasy_team_id,role")
          .eq("league_id",league.id).eq("profile_id",data.user.id).maybeSingle();
        if (allowError || memberError) return null;
        return {id:data.user.id,commissioner:Boolean(allowed && member?.role==="COMMISSIONER"),member:Boolean(member?.fantasy_team_id)};
      })();
      const user=await identity;
      return user && (user.commissioner || (allowMember && user.member)) ? user.id : null;
    }
    const paidFetch=async(input: string, init: RequestInit={}, options: {allowMember?:boolean}={})=>{
      const url=new URL(input);
      if(url.origin!=="https://api.sportsgameodds.com" || url.pathname!=="/v2/events"
        || (init.method && init.method!=="GET")) throw new Error("unsupported_paid_request");
      const limit=Number(url.searchParams.get("limit"));
      if(!Number.isInteger(limit) || limit<1 || limit>40 || url.search.length>6000
        || url.username || url.password || url.searchParams.has("apiKey")) throw new Error("unsupported_paid_request");
      // Canonicalize set-valued query parameters to share snapshots across callers.
      for(const field of ["leagueID","eventID","oddID","bookmakerID"]){
        if(url.searchParams.has(field)) url.searchParams.set(field,[...new Set(url.searchParams.get(field)!.split(","))].sort().join(","));
      }
      url.searchParams.sort();
      const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("sgo-events-v1:"+url.toString()));
      const key=Array.from(new Uint8Array(bytes)).map(v=>v.toString(16).padStart(2,"0")).join("");
      const client=database();
      if(policy.weeklyAnalysis){
        // Cache hits don't consume weekly runs. Never let a caller opt into this policy.
        const {data:cached,error:cacheError}=await client.from('provider_cache').select('payload,observed_at')
          .eq('provider','sportsgameodds').eq('cache_key',key).gt('expires_at',new Date().toISOString()).maybeSingle();
        if(cacheError)throw new Error('provider_accounting_unavailable');
        if(cached){evidence.push({observed_at:cached.observed_at,cached:true});return Response.json(cached.payload);}
        if(!analysisReservation)analysisReservation=(async()=>{
          const id=await actor(true);if(!id)throw new Error('analysis_winner_only');
          const {data,error}=await client.rpc('reserve_weekly_analysis',{p_actor:id});
          if(error)throw new Error(error.message);if(!data?.run_id)throw new Error('analysis_disabled');return data;
        })();
        await analysisReservation;
      }
      const {data:reservation,error}=await client.rpc("reserve_provider_request",{p_key:key,
        p_actor:await actor(options.allowMember===true || policy.weeklyAnalysis===true),p_allow_member:options.allowMember===true || policy.weeklyAnalysis===true});
      if(error) throw new Error(error.message);
      if(reservation?.cached){
        evidence.push({observed_at:reservation.observed_at,cached:true});
        return Response.json(reservation.payload,{headers:{"x-provider-observed-at":reservation.observed_at}});
      }
      if(!reservation?.reservation_id) throw new Error("paid_requests_disabled");
      const id=reservation.reservation_id;
      let status=0;
      try {
        const response=await fetch(url.toString(),{...init,redirect:"error",signal:AbortSignal.timeout(15000)});
        status=response.status;
        if(!response.ok) throw new Error("provider_request_failed");
        const raw=await response.text();
        if(raw.length>4000000) throw new Error("provider_payload_too_large");
        const payload=JSON.parse(raw);
        if(payload?.success===false || !Array.isArray(payload?.data)) throw new Error("provider_request_failed");
        const {error:finishError}=await client.rpc("finish_provider_request",{p_id:id,p_status:200,p_payload:payload});
        if(finishError) throw new Error("provider_accounting_unavailable");
        const observed=new Date().toISOString();
        evidence.push({observed_at:observed,cached:false});
        return Response.json(payload,{headers:{"x-provider-observed-at":observed}});
      } catch(error) {
        // Full reservation remains charged, even for timeouts or unknown completion.
        await client.rpc("finish_provider_request",{p_id:id,p_status:status || 0,p_payload:null}).catch(()=>{});
        throw error;
      }
    };
    try {
      if(req.method === "POST" && (await req.clone().text()).length > 32768) {
        return Response.json({error:"request_too_large"},{status:413,headers:{"Access-Control-Allow-Origin":"*"}});
      }
      const response=await handler(req,paidFetch);
      if(response.ok && evidence.length && response.headers.get("content-type")?.includes("application/json")){
        const body=await response.json();
        body.provider_cache={oldest_observed_at:evidence.map(e=>e.observed_at).sort()[0],
          snapshots:evidence.length,served_from_cache:evidence.every(e=>e.cached),ttl_seconds:180};
        return Response.json(body,{status:response.status,headers:response.headers});
      }
      return response;
    } catch(error) {
      const code=error instanceof Error ? error.message : "";
      const known=new Set(["integrations_disabled","integration_budget_exhausted","analysis_disabled","analysis_winner_only","analysis_winner_unavailable","analysis_window_closed","analysis_weekly_limit","analysis_cooldown","paid_requests_disabled","fresh_provider_request_not_authorized","provider_refresh_in_progress",
        "provider_concurrency_limit","provider_budget_exhausted","provider_user_quota_exhausted"]);
      return Response.json({error:known.has(code)?code:"provider_request_unavailable"},{status:503,
        headers:{"Access-Control-Allow-Origin":"*","Content-Type":"application/json","Cache-Control":"no-store"}});
    }
  };
}
