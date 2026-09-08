import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import {paidHandler} from '../_shared/paid.ts';
import {collectBuilderMarkets} from '../_shared/builder-markets.ts';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405});
 const raw=await req.text();let body;try{body=JSON.parse(raw);}catch{return Response.json({error:'scheduled_only'},{status:403});}
 if(raw.length>100 || body?.scheduled!==true || Object.keys(body).length!==1)return Response.json({error:'scheduled_only'},{status:403});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const {data:job,error}=await db.rpc('claim_builder_refresh');
 if(error)return Response.json({error:'claim_failed'},{status:503});
 if(job?.skipped)return Response.json({skipped:job.skipped});
 const apiKey=Deno.env.get('SPORTSGAMEODDS_API_KEY')||'';
 const work=async()=>{
  let failed=false;
  try{
   // Auth admin API verifies the scheduled actor without granting SQL access to auth.users.
   const {data:identity,error:identityError}=await db.auth.admin.getUserById(job.actor);
   const user=identity?.user;
   if(identityError || !user?.email_confirmed_at || !user.email)throw Error('actor_unavailable');
   const {data:league}=await db.from('leagues').select('id').eq('name','DU Shamers').single();
   const {data:allowed,error:allowError}=await db.from('commissioner_allowlist').select('id').eq('league_id',league?.id).eq('email',user.email.toLowerCase()).maybeSingle();
   if(allowError || !allowed)throw Error('actor_unavailable');
   // Refresh the usage baseline automatically; never weaken the 24-hour usage gate.
   const {data:started,error:usageLock}=await db.rpc('begin_usage_check');
   if(!usageLock){
    const r=await fetch('https://api.sportsgameodds.com/v2/account/usage',{headers:{'x-api-key':apiKey},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('usage_failed');
    const usage=await r.json(),month=usage?.data?.rateLimits?.['per-month'];
    const used=month?.['current-entities'],limit=month?.['max-entities'];
    if(usage.success!==true || !Number.isSafeInteger(used) || used<0 || !Number.isSafeInteger(limit) || limit<=0)throw Error('usage_failed');
    const {error:e}=await db.from('provider_object_policy').update({reported_used:used,reported_limit:limit,reported_at:started}).eq('singleton',true);if(e)throw Error('usage_failed');
   }
   for(const league of ['NFL','NCAAF']){
    const r=await paidHandler(async(_req:Request,paidFetch:any)=>{
     const payload=await collectBuilderMarkets(league,apiKey,paidFetch);
     if(!payload.coverage.complete)return Response.json({error:'incomplete_schedule'},{status:503});
     const {error:e}=await db.from('builder_snapshots').upsert({league,payload,observed_at:payload.generated_at});
     return Response.json({ok:!e},{status:e?503:200});
    },{backgroundActor:job.actor})(new Request(req.url,{method:'GET'}));
    if(!r.ok)failed=true;
   }
  }catch{failed=true;}
  await db.from('builder_refresh_policy').update({last_error:failed?'daily_refresh_failed':null}).eq('singleton',true).eq('last_slot',job.slot);
 };
 // Pagination can exceed a gateway request's duration; keep the bounded job alive.
 EdgeRuntime.waitUntil(work());
 return Response.json({accepted:true});
});
