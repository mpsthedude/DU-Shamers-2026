const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
test('zero overall ceiling can be enabled while invalid amounts remain rejected',async()=>{
 let handler,writes=0;const db={from:()=>({update:()=>({eq:async()=>{writes++;return {error:null}}})})};
 const c=vm.createContext({Request,Response,console,Deno:{serve:f=>handler=f,env:{get:()=>''}}});
 vm.runInContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/commissioner-api/index.ts','utf8').replace(/^import .*;\r?\n/gm,'')),c);
 c.context=async()=>({db,user:{id:'test'},league:{},season:{}});
 const call=policy=>handler(new Request('https://example.invalid',{method:'POST',body:JSON.stringify({action:'set_integration_budget',policy})}));
 assert.equal((await call({enabled:true,daily_microusd:0,monthly_microusd:0})).status,200);
 assert.equal((await call({enabled:true,daily_microusd:-1,monthly_microusd:0})).status,400);assert.equal(writes,1);
});
test('market loading awaits stored session and exposes the actual blocked gate',async()=>{
 const c=vm.createContext({console,window:{addEventListener(){}},authClient:{auth:{getSession:async()=>({data:{session:{access_token:'test-token'}}})}},fetch:async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer test-token');return {ok:false,json:async()=>({error:'integrations_disabled'})}}});
 vm.runInContext(fs.readFileSync('live.js','utf8'),c);
 await assert.rejects(c.fetchMarketLeague('NFL'),/integrations_disabled/);
 assert.match(c.marketLoadError('integrations_disabled'),/overall integration switch/);
 assert.match(c.marketLoadError('provider_usage_refresh_required'),/Check provider usage/);
});
