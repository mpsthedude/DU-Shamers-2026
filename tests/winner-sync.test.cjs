const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../supabase/functions/sync-weekly-winner/index.ts'),'utf8').replace(/^import .*;\r?\n/gm,''));
function harness(options={}){
  const calls=[];let handler;
  const instant=options.time||'2026-09-15T13:05:00Z';
  class Clock extends Date{constructor(...args){super(...(args.length?args:[instant]));}}
  const db={from(){const q={select(){return q;},eq(){return q;},async single(){return {data:{id:'season'}};}};return q;},
    async rpc(name,args){calls.push({name,args});return name==='begin_weekly_sync'?
      {data:options.reservation||{lease_id:'lease'}}:options.saveError?{error:{message:'private database details'}}:
      {data:options.result||{ok:true,week:1,winner_team_id:'3'}};}};
  const ctx=vm.createContext({Date:Clock,Request,Response,TextEncoder,Uint8Array,crypto:require('node:crypto').webcrypto,
    createClient:()=>db,Deno:{env:{get:()=> 'private-value'},serve:fn=>handler=fn},
    fetchStandings:async()=>{calls.push({name:'ESPN'});if(options.fetchError)throw new Error('private-value');return {scoring_period:2};}});
  vm.runInContext(source,ctx);
  return {calls,run:(body={scheduled:true},method='POST')=>handler(new Request('https://fixture.invalid',{method,...(method==='POST'?{body:JSON.stringify(body)}:{})}))};
}
test('scheduled endpoint rejects unrequested and out-of-window calls without ESPN access',async()=>{
  for(const time of ['2026-09-14T13:05:00Z','2026-09-15T14:05:00Z','2026-11-10T13:05:00Z']){
    const h=harness({time});assert.equal((await (await h.run()).json()).skipped,'outside_tuesday_9am_et_window');assert.equal(h.calls.length,0);
  }
  const h=harness();assert.equal((await h.run({scheduled:false})).status,403);
  assert.equal((await h.run(null)).status,403);assert.equal((await h.run(null,'GET')).status,405);assert.equal(h.calls.length,0);
});
test('summer and winter 9 AM runs reserve before ESPN and ignore caller-provided week',async()=>{
  for(const time of ['2026-09-15T13:05:00Z','2026-11-10T14:05:00Z']){
    const h=harness({time});const response=await h.run({scheduled:true,week:999});assert.equal(response.status,200);
    assert.deepEqual(h.calls.map(c=>c.name),['begin_weekly_sync','ESPN','finish_weekly_sync']);
    assert.equal(h.calls[2].args.p_payload.scoring_period,2);assert.equal(h.calls[2].args.p_lease,'lease');
    assert.match(h.calls[2].args.p_hash,/^[a-f0-9]{64}$/);assert.equal(h.calls[2].args.week,undefined);
  }
});
test('cooldown skips provider calls; incomplete results fail the scheduled job',async()=>{
  const h=harness({reservation:{skipped:'sync_cooldown'}});
  assert.equal((await (await h.run()).json()).skipped,'sync_cooldown');assert.equal(h.calls.length,1);
  const incomplete=harness({result:{ok:false,skipped:'scores_not_finalized'}});assert.equal((await incomplete.run()).status,409);
});
test('provider and database failures expose no credentials and do not claim success',async()=>{
  for(const options of [{fetchError:true},{saveError:true}]){
    const h=harness(options);const response=await h.run();assert.equal(response.status,503);
    assert.doesNotMatch(await response.text(),/private/);
    if(options.fetchError)assert.deepEqual(h.calls.map(c=>c.name),['begin_weekly_sync','ESPN']);
  }
});
