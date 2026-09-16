const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
function harness(denied=false){
 let handler,calls=[];
 const ctx=vm.createContext({Request,Response,URL,console,Deno:{serve:fn=>handler=fn}});
 const code=fs.readFileSync('supabase/functions/commissioner-api/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
 vm.runInContext(stripTypeScriptTypes(code),ctx);
 const db={from(table){const q={select(){return q},eq(){return q},async single(){return {data:table==='leagues'?{id:'test-league',name:'DU Shamers Test'}:{id:'test-season'}}}};return q},async rpc(name,args){calls.push({name,args});return {data:{ok:true}}}};
 ctx.context=async()=>denied?{error:Response.json({error:'commissioner_not_authorized'},{status:403})}:{db,user:{id:'commissioner'},league:{id:'real-league'},season:{id:'real-season'},commissioner:{}};
 return {calls,post:(body,scope='test')=>handler(new Request('https://example.test?scope='+scope,{method:'POST',body:JSON.stringify(body)}))};
}
const request={action:'confirm_placement',proposal_id:'11111111-1111-4111-8111-111111111111',placed_american_odds:300};
test('test placement and settlement are locked to isolated season',async()=>{const h=harness();assert.equal((await h.post(request)).status,200);assert.equal(h.calls[0].args.p_season,'test-season');await h.post({action:'settle_bet',bet_id:request.proposal_id,status:'LOST',settlement_return_cents:0});assert.equal(h.calls[1].args.p_season,'test-season');});
test('test scope cannot change budgets or bypass commissioner authorization',async()=>{const h=harness();assert.equal((await h.post({action:'set_object_limit',limit:100000})).status,403);assert.equal(h.calls.length,0);assert.equal((await harness(true).post(request)).status,403);});
test('normal placements retain real league scope',async()=>{const h=harness();await h.post(request,'');assert.equal(h.calls[0].args.p_season,'real-season');});
