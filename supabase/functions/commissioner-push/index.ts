import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import {validEndpoint,validKey} from './validation.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{...cors,'Cache-Control':'no-store'}});
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
async function authorized(user:any,leagueId:string) {
  if(!user?.email_confirmed_at || !user.email) return false;
  const [allow,member,owner]=await Promise.all([
    db.from('commissioner_allowlist').select('id').eq('league_id',leagueId).eq('email',user.email.toLowerCase()).maybeSingle(),
    db.from('league_members').select('id').eq('league_id',leagueId).eq('profile_id',user.id).eq('role','COMMISSIONER').maybeSingle(),
    db.from('league_owner_directory').select('id').eq('league_id',leagueId).eq('email',user.email.toLowerCase()).eq('active',true).maybeSingle()
  ]);
  return !!(allow.data && member.data && owner.data);
}
async function config(create=false) {
  let {data,error}=await db.from('push_config').select('*').eq('singleton',true).maybeSingle();
  if(error) throw new Error('configuration_unavailable');
  if(!data && create){const keys=webpush.generateVAPIDKeys();const saved=await db.from('push_config').upsert({singleton:true,public_key:keys.publicKey,private_key:keys.privateKey},{onConflict:'singleton',ignoreDuplicates:true});if(saved.error)throw new Error('configuration_unavailable');({data}=await db.from('push_config').select('*').eq('singleton',true).single());}
  return data;
}
async function dispatch() {
  const keys=await config();if(!keys)return;
  const {data:jobs,error}=await db.rpc('claim_push_deliveries');if(error)throw new Error('queue_unavailable');
  for(const job of jobs||[]) {
    const finish=async(state:string,error:string|null=null)=>{const r=await db.from('push_deliveries').update({state,error}).eq('id',job.id);if(r.error)console.error('push_status_write_failed');};
    try {
      const {data:sub}=await db.from('push_subscriptions').select('*').eq('id',job.subscription_id).maybeSingle();
      if(!sub){continue;}
      const {data:identity}=await db.auth.admin.getUserById(sub.profile_id);
      if(!validEndpoint(sub.endpoint) || !await authorized(identity.user,sub.league_id)){await finish('SKIPPED','authorization_removed');continue;}
      let body='Commissioner alerts are working. Tap to open your review queue.';
      if(job.proposal_id){
        const {data:p}=await db.from('bet_proposals').select('status,category,proposed_stake_cents,first_event_start_at,hard_deadline_at,season_id').eq('id',job.proposal_id).maybeSingle();
        const {data:season}=p?await db.from('seasons').select('league_id').eq('id',p.season_id).maybeSingle():{data:null};
        if(!p || season?.league_id!==sub.league_id || p.category!=='WEEKLY' || p.status!=='AWAITING_COMMISSIONER_PLACEMENT' || [p.first_event_start_at,p.hard_deadline_at].some(t=>t && Date.parse(t)<=Date.now())){await finish('SKIPPED','ticket_no_longer_pending');continue;}
        body=`A $${(p.proposed_stake_cents/100).toFixed(0)} weekly ticket is ready for your review.`;
      }
      const tag=job.proposal_id || job.id;
      const request=webpush.generateRequestDetails({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth_key}},JSON.stringify({body,tag}),{vapidDetails:{subject:'mailto:sloopstone@gmail.com',publicKey:keys.public_key,privateKey:keys.private_key},TTL:3600,urgency:'high',topic:tag.replace(/-/g,'')});
      const response=await fetch(request.endpoint,{method:'POST',headers:request.headers,body:request.body,redirect:'error',signal:AbortSignal.timeout(8000)});
      await response.body?.cancel();
      if(response.ok)await finish('SENT');
      else if([404,410].includes(response.status)){const removed=await db.from('push_subscriptions').delete().eq('id',sub.id);if(removed.error)await finish('FAILED','expired_subscription');}
      else if(response.status===429 || response.status>=500)await finish(job.attempts>=3?'FAILED':'SENDING','push_service_unavailable');
      else await finish('FAILED','push_service_rejected');
    }catch{await finish(job.attempts>=3?'FAILED':'SENDING','delivery_failed');}
  }
}
function runDispatch(){EdgeRuntime.waitUntil(dispatch().catch(()=>console.error('push_dispatch_failed')));}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(!['GET','POST'].includes(req.method))return json({error:'method_not_allowed'},405);
  try {
    let body:any={};
    if(req.method==='POST'){const raw=await req.text();if(raw.length>8192)return json({error:'request_too_large'},413);try{body=JSON.parse(raw);}catch{return json({error:'invalid_request'},400);}}
    // Public cron can only drain already committed jobs; it cannot choose recipients or content.
    if(body?.scheduled===true && Object.keys(body).length===1){runDispatch();return json({queued:true},202);}
    const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
    if(!token)return json({error:'sign_in_required'},401);
    const {data:identity,error}=await db.auth.getUser(token);
    if(error || !identity.user)return json({error:'sign_in_required'},401);
    const {data:league}=await db.from('leagues').select('id').eq('name','DU Shamers').single();
    if(!league || !await authorized(identity.user,league.id))return json({error:'commissioner_not_authorized'},403);
    if(req.method==='GET'){const keys=await config(true);return json({publicKey:keys.public_key});}
    const endpoint=body.subscription?.endpoint || body.endpoint;
    if(!validEndpoint(endpoint))return json({error:'unsupported_push_endpoint'},400);
    if(body.action==='status'){
      const {data:sub,error}=await db.from('push_subscriptions').select('id').eq('endpoint',endpoint).eq('profile_id',identity.user.id).eq('league_id',league.id).maybeSingle();
      if(error)throw error;
      const {data:last}=sub?await db.from('push_deliveries').select('state,created_at').eq('subscription_id',sub.id).order('created_at',{ascending:false}).limit(1).maybeSingle():{data:null};
      return json({enabled:!!sub,last});
    }
    if(!['enable','disable','test'].includes(body.action))return json({error:'invalid_action'},400);
    if(body.action==='enable' && (!validKey(body.subscription?.keys?.p256dh,65) || !validKey(body.subscription?.keys?.auth,16)))return json({error:'invalid_subscription_keys'},400);
    const result=await db.rpc('manage_push_subscription',{p_actor:identity.user.id,p_league:league.id,p_action:body.action,p_endpoint:endpoint,p_key:body.subscription?.keys?.p256dh||null,p_auth:body.subscription?.keys?.auth||null});
    if(result.error){const known=['device_limit','test_cooldown','device_not_enabled','subscription_conflict','commissioner_not_authorized'];return json({error:known.includes(result.error.message)?result.error.message:'subscription_update_failed'},409);}
    if(body.action==='test')runDispatch();
    return json({ok:true,queued:body.action==='test'});
  }catch{return json({error:'push_service_unavailable'},503);}
});
