import { createClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";
import { paidHandler } from "../_shared/paid.ts";
import { eventProgress } from "../_shared/tracker.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405,headers});
 if((await req.clone().text()).length>100 || (await req.json().catch(()=>null))?.scheduled!==true)return Response.json({error:'scheduled_only'},{status:403,headers});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 // Public scheduler triggers can only claim this fixed, globally throttled job.
 const {data:job,error}=await db.rpc('claim_tracker_refresh');
 if(error)return Response.json({error:'tracker_claim_failed'},{status:503,headers});
 if(job?.skipped)return Response.json({skipped:job.skipped},{headers});
 if(!job?.lease_id || !job?.actor)return Response.json({error:'tracker_claim_failed'},{status:503,headers});
 const response=await paidHandler(async(_req:Request,paidFetch:any)=>{
  const ids=job.events.map((e:any)=>e.event_id);
  const {data:legs,error:legError}=await db.from('bet_proposal_legs').select('event_id,odd_id').in('event_id',ids);
  if(legError)throw new Error('tracker_read_failed');
  const params=new URLSearchParams({eventID:ids.join(','),limit:'40',oddID:'points-home-game-ml-home',bookmakerID:'draftkings'});
  const r=await paidFetch('https://api.sportsgameodds.com/v2/events?'+params,{headers:{'x-api-key':Deno.env.get('SPORTSGAMEODDS_API_KEY')||''}});
  const payload=await r.json();
  const observed=r.headers.get('x-provider-observed-at')||new Date().toISOString();
  const snapshots=payload.data.filter((e:any)=>ids.includes(e.eventID) && ['NFL','NCAAF'].includes(e.leagueID)).map((e:any)=>{
   const progress=eventProgress(e,legs.filter((l:any)=>l.event_id===e.eventID));
   return {event_id:e.eventID,observed_at:observed,terminal:['finished','cancelled'].includes(progress.phase),payload:progress};
  });
  if(snapshots.length){const {error:saveError}=await db.from('tracker_events').upsert(snapshots);if(saveError)throw new Error('tracker_save_failed');}
  return Response.json({ok:true,events:snapshots.length},{headers});
 },{backgroundActor:job.actor})(new Request(req.url,{method:'POST',body:'{}'}));
 await db.from('tracker_policy').update({lease_until:null,last_error:response.ok?null:'tracker_refresh_failed'}).eq('singleton',true).eq('lease_id',job.lease_id);
 return response;
});
