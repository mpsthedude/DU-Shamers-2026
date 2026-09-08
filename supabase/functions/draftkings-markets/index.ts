import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, OPTIONS','Cache-Control':'no-store'};
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='GET')return Response.json({error:'method_not_allowed'},{status:405,headers});
 const league=(new URL(req.url).searchParams.get('league')||'NFL').toUpperCase();
 if(!['NFL','NCAAF'].includes(league))return Response.json({error:'unsupported_league'},{status:400,headers});
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const {data,error}=await db.from('builder_snapshots').select('payload,observed_at').eq('league',league).maybeSingle();
 if(error || !data)return Response.json({error:'daily_snapshot_unavailable'},{status:503,headers});
 return Response.json({...data.payload,events:(data.payload.events||[]).filter((e:any)=>Date.parse(e.starts_at)>Date.now()),
  stale:Date.now()-Date.parse(data.observed_at)>25*3600000,refresh_interval_hours:24,
  provider_cache:{oldest_observed_at:data.observed_at,served_from_cache:true}}, {headers});
});
