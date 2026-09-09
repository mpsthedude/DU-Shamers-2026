const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
function harness() {
  let handler; let validations=0; const calls=[];
  const ctx=vm.createContext({ticketConflict:require('../ticket-rules.js').ticketConflict,Request,Response,URL,URLSearchParams,AbortSignal,console,
    paidHandler:fn=>req=>fn(req,async()=>{throw new Error('unexpected_provider_call');}),
    Deno:{env:{get:()=> 'fixture'},serve:fn=>handler=fn},createClient:()=>({})});
  const code=fs.readFileSync(path.join(__dirname,'../supabase/functions/member-api/index.ts'),'utf8').replace(/^import .*;\r?\n/gm,'');
  vm.runInContext(stripTypeScriptTypes(code),ctx);
  const db={rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true,replayed:true,proposal:{id:'saved'}},error:null};}};
  ctx.authenticatedContext=async()=>({db,user:{id:'actor'},league:{id:'league'},membership:{id:'member',fantasy_team_id:'1'}});
  ctx.currentSeasonAndAward=async()=>({season:{id:'season'}});
  ctx.validateLiveLegs=async()=>{validations++;return [];};
  return {ctx,calls,get validations(){return validations;},post:body=>handler(new Request('https://example.invalid',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}))};
}
const leg={event_id:'event',odd_id:'points-home-game-sp-home',sport:'NFL',odds:-110,line:-3.5};
function event(){
  return {eventID:'event',leagueID:'NFL',status:{startsAt:'2026-09-20T17:00:00Z'},
    teams:{home:{names:{long:'Home Team'}},away:{names:{long:'Away Team'}}},
    odds:{[leg.odd_id]:{oddID:leg.odd_id,periodID:'game',statEntityID:'home',betTypeID:'sp',sideID:'home',
      marketName:'Spread',byBookmaker:{draftkings:{available:true,odds:'-110',spread:'-3.5'}}}}};
}
test('weekly requests reject oversized tickets, duplicate selections and malformed prices',()=>{
  const {ctx}=harness();
  assert.throws(()=>ctx.requestedLegs(Array(13).fill(leg)),/legs_limit/);
  assert.throws(()=>ctx.requestedLegs([leg,leg]),/duplicate_selection/);
  assert.equal(ctx.requestedLegs([leg,{...leg,odd_id:'passing_yards-player-game-ou-over'}]).length,2);
  assert.throws(()=>ctx.requestedLegs([{...leg,odds:'1e3'}]),/invalid_leg/);
  assert.equal(ctx.requestedLegs([{...leg,odds:'-110'}])[0].odds,-110);
});
test('verified selection uses provider names and rejects changed DraftKings odds or lines',()=>{
  const {ctx}=harness();const now=new Date('2026-09-15T14:00:00Z');
  const good=ctx.verifiedLeg(event(),{...leg,selection:'Forged description'},now);
  assert.equal(good.line_value,-3.5);
  assert.match(good.selection,/Home Team/);assert.doesNotMatch(good.selection,/Forged/);
  for(const change of [
    e=>e.odds[leg.odd_id].byBookmaker.draftkings.spread='-4.5',
    e=>e.odds[leg.odd_id].byBookmaker.draftkings.odds='-115',
  ]){const e=event();change(e);assert.throws(()=>ctx.verifiedLeg(e,leg,now),/selection_changed/);}
  const wrong=event();wrong.leagueID='NBA';assert.throws(()=>ctx.verifiedLeg(wrong,leg,now),/event_mismatch/);
  const missing=event();delete missing.odds[leg.odd_id].byBookmaker.draftkings;
  assert.throws(()=>ctx.verifiedLeg(missing,leg,now),/selection_unavailable/);
  const started=event();started.status.started=true;
  assert.throws(()=>ctx.verifiedLeg(started,leg,now),/event_already_started/);
});
test('player props use verified names and reject changed lines, odds, missing players and started games',()=>{
  const {ctx}=harness(),now=new Date('2026-09-15T14:00:00Z');
  const prop={event_id:'event',odd_id:'passing_yards-player-game-ou-over',sport:'NFL',odds:-110,line:249.5};
  const e=event();e.players={player:{names:{display:'Verified Quarterback'}}};
  e.odds={[prop.odd_id]:{oddID:prop.odd_id,periodID:'game',statEntityID:'player',betTypeID:'ou',sideID:'over',marketName:'Passing Yards',byBookmaker:{draftkings:{available:true,odds:-110,overUnder:249.5}}}};
  const result=ctx.verifiedLeg(e,{...prop,player_name:'Forged'},now);
  assert.match(result.selection,/Verified Quarterback.*Passing Yards.*over 249.5/);
  for(const mutate of [x=>x.odds[prop.odd_id].byBookmaker.draftkings.overUnder=250.5,x=>x.odds[prop.odd_id].byBookmaker.draftkings.odds=-115]){
    const changed=structuredClone(e);mutate(changed);assert.throws(()=>ctx.verifiedLeg(changed,prop,now),/selection_changed/);
  }
  const missing=structuredClone(e);missing.players={};assert.throws(()=>ctx.verifiedLeg(missing,prop,now),/selection_unavailable/);
  const unavailable=structuredClone(e);unavailable.odds[prop.odd_id].byBookmaker.draftkings.available=false;assert.throws(()=>ctx.verifiedLeg(unavailable,prop,now),/selection_unavailable/);
  e.status.started=true;assert.throws(()=>ctx.verifiedLeg(e,prop,now),/event_already_started/);
});

test('award window binds to the identification week and handles the fall DST cutoff',()=>{
  const {ctx}=harness();
  const award={week:8,source_status:'WINNER_IDENTIFIED',identified_at:'2026-10-27T13:00:00Z',source_observed_at:'2026-10-27T13:00:00Z'};
  for(const [date,open] of [['2026-10-27T12:59:59Z',false],['2026-10-27T13:00:00Z',true],
    ['2026-11-01T15:59:59Z',true],['2026-11-01T16:00:00Z',false],['2026-11-03T14:00:00Z',false]]){
    assert.equal(ctx.awardWindowOpen(award,new Date(date)),open,date);
  }
  assert.equal(ctx.awardWindowOpen({...award,requires_commissioner_resolution:true},new Date('2026-10-28T14:00Z')),false);
});
test('saved submission retries return before any fresh provider validation',async()=>{
  const h=harness();const body={action:'submit_weekly_bet',choice:'split',
    award_id:'11111111-1111-4111-8111-111111111111',request_id:'22222222-2222-4222-8222-222222222222',legs:[leg]};
  assert.equal((await h.post(body)).status,200);
  assert.equal(h.validations,0);assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].args.p_choice,'SPLIT_50_50');
  assert.equal(h.calls[0].args.p_actor,'actor');
  assert.equal((await h.post({...body,legs:Array(13).fill(leg)})).status,400);
  assert.equal(h.calls.length,1);
});
