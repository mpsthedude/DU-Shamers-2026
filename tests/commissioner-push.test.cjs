const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const validation=stripTypeScriptTypes(fs.readFileSync('supabase/functions/commissioner-push/validation.ts','utf8')).replaceAll('export ','');
const context={URL,atob};vm.createContext(context);vm.runInContext(validation,context);
function workerHarness({status=201,allowed=true,pending=true,attempts=1}={}){
  let handler;const updates=[],deleted=[],requests=[],tasks=[];
  const rows={push_config:{public_key:'public',private_key:'private'},push_subscriptions:{id:'sub',profile_id:'actor',league_id:'league',endpoint:'https://web.push.apple.com/token',p256dh:'key',auth_key:'auth'},commissioner_allowlist:allowed?{id:'allow'}:null,league_members:{id:'member'},league_owner_directory:{id:'owner'},bet_proposals:{status:pending?'AWAITING_COMMISSIONER_PLACEMENT':'PLACED',category:'WEEKLY',proposed_stake_cents:10000,season_id:'season'},seasons:{league_id:'league'}};
  const db={auth:{admin:{getUserById:async()=>({data:{user:{id:'actor',email:'owner@example.test',email_confirmed_at:'yes'}}})},getUser:async()=>({data:{user:null},error:true})},rpc:async()=>({data:[{id:'job',subscription_id:'sub',proposal_id:'proposal',attempts}]}),from:table=>{
    const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:rows[table]}),update(value){updates.push(value);return q;},delete(){deleted.push(table);return q;},then(resolve){resolve({error:null});}};return q;
  }};
  const ctx=vm.createContext({Response,Request,URL,AbortSignal,console:{error(){}},createClient:()=>db,validEndpoint:context.validEndpoint,validKey:context.validKey,Deno:{env:{get:()=>''},serve:fn=>handler=fn},EdgeRuntime:{waitUntil:p=>tasks.push(p)},webpush:{generateRequestDetails:(sub,payload)=>{requests.push(JSON.parse(payload));return{endpoint:sub.endpoint,headers:{},body:'encrypted'};}},fetch:async(url,options)=>{assert.equal(options.redirect,'error');return new Response(null,{status});}});
  const source=fs.readFileSync('supabase/functions/commissioner-push/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
  vm.runInContext(stripTypeScriptTypes(source),ctx);
  return{updates,deleted,requests,async run(){await handler(new Request('https://example.test',{method:'POST',body:'{"scheduled":true}'}));await Promise.all(tasks);}};
}
test('delivery checks current commissioner authorization and pending ticket state',async()=>{
  for(const options of [{allowed:false},{pending:false}]){const h=workerHarness(options);await h.run();assert.equal(h.requests.length,0);assert.equal(h.updates[0].state,'SKIPPED');}
  const h=workerHarness();await h.run();assert.equal(h.requests[0].body,'A $100 weekly ticket is ready for your review.');assert.equal(h.updates[0].state,'SENT');
});
test('expired subscriptions are removed and temporary failures have a bounded retry',async()=>{
  const expired=workerHarness({status:410});await expired.run();assert.deepEqual(expired.deleted,['push_subscriptions']);
  for(const attempts of [1,3]){const h=workerHarness({status:503,attempts});await h.run();assert.equal(h.updates[0].state,attempts===3?'FAILED':'SENDING');}
});
test('push endpoints reject SSRF, credentials, spoofed hosts and insecure transport',()=>{
  for(const host of ['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com'])assert.equal(context.validEndpoint(`https://${host}/opaque-token`),true);
  for(const endpoint of ['https://127.0.0.1/','http://fcm.googleapis.com/a','https://fcm.googleapis.com.evil.test/a','https://a:b@web.push.apple.com/a','https://web.push.apple.com:8443/a','https://web.push.apple.com/a#fragment'])assert.equal(context.validEndpoint(endpoint),false);
});
test('subscription keys must have valid encoding and P-256 format',()=>{
  assert.equal(context.validKey(Buffer.alloc(16).toString('base64url'),16),true);
  assert.equal(context.validKey(Buffer.concat([Buffer.from([4]),Buffer.alloc(64)]).toString('base64url'),65),true);
  for(const value of [null,'bad!',Buffer.alloc(64).toString('base64url'),Buffer.alloc(65).toString('base64url')])assert.equal(context.validKey(value,65),false);
});
test('notification click ignores remote payload URLs and opens the commissioner queue',async()=>{
  const handlers={};let shown,opened;
  const self={location:{origin:'https://dushamers.com'},addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(title,options)=>shown=options},clients:{matchAll:async()=>[],openWindow:async url=>opened=url}};
  vm.runInNewContext(fs.readFileSync('push-sw.js','utf8'),{self,URL});
  let pending;handlers.push({data:{json:()=>({body:'Review ticket',tag:'ticket-id',url:'https://evil.test'})},waitUntil:p=>pending=p});await pending;
  assert.equal(shown.tag,'ticket-id');assert.equal(shown.data.url,'/#commissioner');
  handlers.notificationclick({notification:{close(){}},waitUntil:p=>pending=p});await pending;
  assert.equal(opened,'https://dushamers.com/#commissioner');assert.equal(handlers.fetch,undefined);
});
