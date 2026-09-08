const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
test('daily list is readable without provider calls, marks stale data and removes started games',async()=>{
 let handler;const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{observed_at:'2020-01-01',payload:{events:[{starts_at:'2020-01-01'},{starts_at:'2099-01-01'}]}}})})})})};
 const ctx=vm.createContext({Request,Response,URL,Date,createClient:()=>db,fetch:()=>{throw Error('Unexpected provider call');},Deno:{env:{get:()=>''},serve:f=>handler=f}});
 vm.runInContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/draftkings-markets/index.ts','utf8').replace(/^import .*;\r?\n/gm,'')),ctx);
 const r=await handler(new Request('https://example.invalid?league=NFL'));const data=await r.json();assert.equal(r.status,200);assert.equal(data.events.length,1);assert.equal(data.stale,true);
});
