const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/draftkings-markets/index.ts','utf8').replace(/^import .*;\r?\n/gm,''));
function event(id){return {eventID:id,leagueID:'NCAAF',status:{startsAt:new Date(Date.now()+86400000).toISOString()},odds:{home:{oddID:'points-home-game-ml-home',byBookmaker:{draftkings:{available:true,odds:150}}}}};}
async function run(pages){let handler;const calls=[];const ctx=vm.createContext({Request,Response,URL,URLSearchParams,console,
 Deno:{env:{get:()=> 'fixture'},serve:fn=>handler=fn},paidHandler:fn=>req=>fn(req,async url=>{calls.push(new URL(url));const page=pages[calls.length-1];if(page instanceof Error)throw page;return Response.json(page);})});
 vm.runInContext(source,ctx);const response=await handler(new Request('https://example.invalid?league=NCAAF'));return {data:await response.json(),calls};}
test('pages share fixed date bounds, preserve opaque cursors and deduplicate games',async()=>{
 const {data,calls}=await run([{data:[event('a')],nextCursor:'opaque + / = token'},{data:[event('a'),event('b')]}]);
 assert.equal(data.events.length,2);assert.equal(data.coverage.complete,true);
 assert.equal(calls[1].searchParams.get('cursor'),'opaque + / = token');
 assert.equal(calls[0].searchParams.get('startsBefore'),calls[1].searchParams.get('startsBefore'));
 assert.equal(calls[0].searchParams.get('limit'),'40');
});
test('later budget denial preserves earlier games and marks incomplete without retries',async()=>{
 const {data,calls}=await run([{data:[event('a')],nextCursor:'next'},new Error('provider_budget_exhausted')]);
 assert.equal(calls.length,2);assert.equal(data.events.length,1);assert.equal(data.coverage.complete,false);
 assert.equal(data.coverage.reason,'remaining_pages_unavailable');
});
test('pagination stops at eight pages and repeated cursors cannot loop',async()=>{
 let r=await run(Array.from({length:8},(_,i)=>({data:[event(String(i))],nextCursor:String(i)})));
 assert.equal(r.calls.length,8);assert.equal(r.data.coverage.reason,'page_limit_reached');
 r=await run([{data:[],nextCursor:'same'},{data:[],nextCursor:'same'}]);
 assert.equal(r.calls.length,2);assert.equal(r.data.coverage.complete,false);
});
test('unavailable DraftKings offers and started games are omitted',async()=>{
 const old=event('old');old.status.startsAt='2020-01-01T00:00:00Z';const unavailable=event('off');unavailable.odds.home.byBookmaker.draftkings.available=false;
 const {data}=await run([{data:[old,unavailable,event('ok')]}]);assert.deepEqual(data.events.map(e=>e.event_id),['ok']);
});
