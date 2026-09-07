const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto'),{stripTypeScriptTypes}=require('node:module');
function harness({cached=false,denied=false}={}){
 let runs=0,network=0;
 const db={auth:{getUser:async()=>({data:{user:{id:'owner',email:'owner@example.invalid'}}})},from(table){const result=()=>({data:table==='provider_cache'?(cached?{payload:{data:[]},observed_at:new Date().toISOString()}:null):table==='leagues'?{id:'league'}:table==='league_members'?{fantasy_team_id:'3',role:'OWNER'}:null});const query={select:()=>query,eq:()=>query,gt:()=>query,single:async()=>result(),maybeSingle:async()=>result()};return query;},rpc:async name=>{if(name==='reserve_weekly_analysis'){runs++;return denied?{error:{message:'analysis_weekly_limit'}}:{data:{run_id:'run'}};}return name==='reserve_provider_request'?{data:{reservation_id:'request'}}:{error:null};}};
 const ctx=vm.createContext({Request,Response,URL,URLSearchParams,TextEncoder,Uint8Array,AbortSignal,crypto:webcrypto,Deno:{env:{get:()=> 'fixture'}},createClient:()=>db,fetch:async()=>{network++;return Response.json({data:[]});}});
 vm.runInContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/paid.ts','utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')),ctx);
 const handler=ctx.paidHandler(async(req,paidFetch)=>{await Promise.all(['one','two'].map(id=>paidFetch('https://api.sportsgameodds.com/v2/events?limit=1&eventID='+id)));return Response.json({ok:true});},{weeklyAnalysis:true});
 return {call:()=>handler(new Request('https://test.invalid',{headers:{authorization:'Bearer fixture'}})),get runs(){return runs;},get network(){return network;}};
}
test('one multi-game analysis reserves only one weekly run despite concurrent requests',async()=>{const h=harness();assert.equal((await h.call()).status,200);assert.equal(h.runs,1);assert.equal(h.network,2);});
test('cached analysis consumes no weekly run or provider request',async()=>{const h=harness({cached:true});assert.equal((await h.call()).status,200);assert.equal(h.runs,0);assert.equal(h.network,0);});
test('weekly quota denial blocks every provider dispatch',async()=>{const h=harness({denied:true});assert.equal((await h.call()).status,503);assert.equal(h.runs,1);assert.equal(h.network,0);});
