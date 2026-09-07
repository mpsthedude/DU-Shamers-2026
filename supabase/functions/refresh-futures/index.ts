import { createClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";
import { matchFutures } from "../_shared/futures.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST') return Response.json({error:'method_not_allowed'},{status:405});
 const raw=await req.text();
 let body;try{body=JSON.parse(raw);}catch{return Response.json({error:'scheduled_only'},{status:403});}
 if(raw.length>100 || body?.scheduled!==true || Object.keys(body).some(k=>k!=='scheduled'))return Response.json({error:'scheduled_only'},{status:403});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const {data:job,error}=await db.rpc('claim_futures_refresh');
 if(error)return Response.json({error:'claim_failed'},{status:503});
 if(job?.skipped)return Response.json({skipped:job.skipped});
 if(!job?.run_id || !job?.api_key)return Response.json({error:'claim_failed'},{status:503});
 let saved=0,failed=false;
 try{
  const sports=[...new Set<string>(job.mappings.map((m:any)=>m.sport_key))];
  if(sports.length>3)throw Error('mapping_limit');
  for(const sport of sports){
   const url=new URL('https://api.the-odds-api.com/v4/sports/'+encodeURIComponent(sport)+'/odds');
   url.search=new URLSearchParams({apiKey:job.api_key,bookmakers:'draftkings',markets:'outrights',oddsFormat:'american'}).toString();
   const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
   if(!response.ok){failed=true;continue;}
   const events=await response.json();
   const rows=job.mappings.filter((m:any)=>m.sport_key===sport).map((m:any)=>matchFutures(events,m)).filter(Boolean).map((r:any)=>({...r,week:job.week}));
   if(rows.length){const result=await db.from('futures_odds_history').upsert(rows,{onConflict:'bet_id,week'});if(result.error)throw Error('save_failed');saved+=rows.length;}
   // Missing/suspended outcomes are retried within bounded limits, never priced at zero.
   if(rows.length!==job.mappings.filter((m:any)=>m.sport_key===sport).length)failed=true;
  }
 }catch{failed=true;} // Never log URLs, provider responses, or credentials.
 const {error:finishError}=await db.from('futures_feed_runs').update({finished_at:new Date().toISOString(),success:!failed,error:failed?'prices_incomplete':null}).eq('id',job.run_id);
 return Response.json({ok:!failed&&!finishError,saved},{status:failed||finishError?503:200});
});
