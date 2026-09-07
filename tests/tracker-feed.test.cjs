const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{stripTypeScriptTypes}=require('node:module'),assert=require('node:assert/strict'),test=require('node:test');
const c=vm.createContext({Date});vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../supabase/functions/_shared/tracker.ts'),'utf8').replace(/^export /gm,'')),c);
test('tracker maps numeric scores and props, preserves missing values and terminal phases',()=>{
 const legs=[{odd_id:'passing_yards-QB_1_NFL-game-ou-over'},{odd_id:'points-all-game-ou-over'}];
 const event={status:{started:true},results:{game:{home:{points:0},away:{points:7},QB_1_NFL:{passing_yards:187}}}};
 const s=c.eventProgress(event,legs);assert.equal(s.values[legs[0].odd_id],187);assert.equal(s.values[legs[1].odd_id],7);assert.equal(s.score,'Away 7 · Home 0');assert.equal(s.phase,'live');
 assert.equal(c.eventProgress({status:{ended:true}},legs).phase,'finished');assert.equal(c.eventProgress({},legs).values[legs[0].odd_id],null);
});
test('ticket progress cannot settle bets and keeps stale or cancelled games explicit',()=>{
 const snapshot=c.ticketProgress([{status:'OPEN',legs:[{odd_id:'points-home-game-ml-home',selection:'Home ML',snapshot:{phase:'finished',score:'Away 7 · Home 0'},observed_at:'2026-09-07T10:00:00Z'}]}],Date.parse('2026-09-07T11:00:00Z'));
 assert.equal(snapshot.tickets[0].status,'OPEN');assert.equal(snapshot.tickets[0].phase,'finished');assert.equal(snapshot.delayed,true);assert.equal(snapshot.tickets[0].legs[0].current,null);
});
test('worker rejects arbitrary requests and paused scheduler before fetching a provider',async()=>{
 let handler,paidCalls=0;const db={rpc:async()=>({data:{skipped:'paused'}})};
 const ctx=vm.createContext({Request,Response,createClient:()=>db,paidHandler:()=>{paidCalls++;throw new Error('unexpected')},Deno:{env:{get:()=>''},serve:f=>handler=f}});
 vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../supabase/functions/refresh-weekly-tracker/index.ts'),'utf8').replace(/^import .*;\r?\n/gm,'')),ctx);
 assert.equal((await handler(new Request('https://test',{method:'GET'}))).status,405);
 assert.equal((await handler(new Request('https://test',{method:'POST',body:'{}'}))).status,403);
 const response=await handler(new Request('https://test',{method:'POST',body:'{"scheduled":true}'}));assert.equal((await response.json()).skipped,'paused');assert.equal(paidCalls,0);
});
