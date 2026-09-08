const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {stripTypeScriptTypes}=require('node:module');
function source(name){return stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../supabase/functions',name),'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''));}
function context(reservation, fetchFails=false){
  let handler, network=0;const calls=[];
  const ctx=vm.createContext({Request,Response,URL,URLSearchParams,AbortSignal,TextEncoder,Uint8Array,crypto:webcrypto,console,
    Deno:{env:{get:()=> 'fixture'},serve:fn=>handler=fn},
    createClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return name==='reserve_provider_request'?reservation:{error:null};}}),
    fetch:async()=>{network++;if(fetchFails)throw Error('network_timeout');return Response.json({success:true,data:[]});}});
  vm.runInContext(source('_shared/paid.ts'),ctx);
  return {ctx,calls,get handler(){return handler;},get network(){return network;}};
}
test('budget denial stops the shared fetch before network dispatch',async()=>{
  const h=context({error:{message:'provider_budget_exhausted'}});
  const handler=h.ctx.paidHandler(async(req,paidFetch)=>paidFetch('https://api.sportsgameodds.com/v2/events?limit=1'));
  const response=await handler(new Request('https://example.invalid'));
  assert.equal(response.status,503);assert.equal(h.network,0);
});
test('public cached data retains its original observation time and makes no paid call',async()=>{
  const observed='2026-09-07T12:00:00Z';
  const h=context({data:{cached:true,payload:{data:[]},observed_at:observed}});
  const response=await h.ctx.paidHandler(async(req,paidFetch)=>paidFetch('https://api.sportsgameodds.com/v2/events?limit=1'))(new Request('https://example.invalid'));
  assert.equal((await response.json()).provider_cache.oldest_observed_at,observed);assert.equal(h.network,0);
});
test('failed dispatch is recorded without automatic retries or a refund',async()=>{
  const h=context({data:{reservation_id:'fixture'}},true);
  const response=await h.ctx.paidHandler(async(req,paidFetch)=>paidFetch('https://api.sportsgameodds.com/v2/events?limit=1'))(new Request('https://example.invalid'));
  assert.equal(response.status,503);assert.equal(h.network,1);
  assert.equal(h.calls[1].name,'finish_provider_request');assert.equal(h.calls[1].args.p_payload,null);
});
test('canonical set ordering reuses the same request key',async()=>{
  const h=context({data:{cached:true,payload:{data:[]},observed_at:'2026-09-07T12:00:00Z'}});
  const handler=h.ctx.paidHandler(async(req,paidFetch)=>{
    await paidFetch('https://api.sportsgameodds.com/v2/events?limit=1&leagueID=NFL,NCAAF');
    return paidFetch('https://api.sportsgameodds.com/v2/events?leagueID=NCAAF,NFL&limit=1');
  });
  await handler(new Request('https://example.invalid'));
  assert.equal(h.calls[0].args.p_key,h.calls[1].args.p_key);
});

for(const slug of ['draftkings-event-props','analyze-ticket','member-api','draftkings-futures','integration-health']){
  test(slug+' cannot call a provider while the global gate is disabled',async()=>{
    const h=context({error:{message:'paid_requests_disabled'}});
    vm.runInContext(source(slug+'/index.ts'),h.ctx);
    let body;
    if(slug==='analyze-ticket' || slug==='member-api') body={action:'submit_weekly_bet',choice:'split',
      request_id:'11111111-1111-4111-8111-111111111111',award_id:'22222222-2222-4222-8222-222222222222',
      legs:[{event_id:'fixture',odd_id:'points-home-game-ml-home',sport:'NFL',odds:150,line:null}]};
    if(slug==='member-api'){
      h.ctx.authenticatedContext=async()=>({db:{rpc:async()=>({data:{validation_required:true}})},user:{id:'actor'},league:{id:'league'},
        membership:{id:'member',fantasy_team_id:'1'}});
      h.ctx.currentSeasonAndAward=async()=>({season:{id:'season'}});
    }
    const req=new Request('https://example.invalid?league=NFL&event_id=fixture',{
      method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const result=await h.handler(req);
    assert.notEqual(result.status,200);assert.equal(h.network,0);
  });
}
