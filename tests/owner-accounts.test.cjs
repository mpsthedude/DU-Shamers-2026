const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {stripTypeScriptTypes}=require('node:module');
test('owner authorization requires a confirmed Auth email and ignores editable team metadata',async()=>{
  const ctx=vm.createContext({});
  vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../supabase/functions/_shared/owners.ts'),'utf8').replace('export ','')),ctx);
  const calls=[];const db={rpc:async(name,args)=>{calls.push({name,args});return {data:{fantasy_team_id:'13'}};}};
  assert.equal((await ctx.verifiedOwner(db,{id:'owner',email:'owner@example.invalid'},'league')).error,'verified_email_required');
  assert.equal(calls.length,0);
  await ctx.verifiedOwner(db,{id:'owner',email:'owner@example.invalid',email_confirmed_at:'2026-09-07',user_metadata:{fantasy_team_id:'3',role:'COMMISSIONER'}},'league');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{name:'link_verified_owner',args:{p_actor:'owner',p_league:'league',p_email:'owner@example.invalid'}}]);
});
function passwordHarness(updateError=null){
  const nodes=new Map();
  const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{textContent:'',disabled:false,addEventListener(type,fn){this[type]=fn;}});return nodes.get(selector);};
  const calls=[];const ctx=vm.createContext({incomingAuthError:false,passwordMode:'change',accountActionBusy:false,
    authClient:{auth:{updateUser:async values=>{calls.push(['update',values]);return {error:updateError};},signOut:async options=>{calls.push(['signOut',options]);return {};}}},
    refreshMemberState:async()=>{},openMemberModal(){},showToast(){},renderMemberModal(){}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../account-password.js'),'utf8'),ctx);
  ctx.renderAccountPassword({innerHTML:'',querySelector:node},'change');
  const form={elements:{current:{value:'old-password'},password:{value:'new-password-123'},confirmation:{value:'new-password-123'}},querySelector:()=>node('submit'),reset(){calls.push(['reset']);}};
  return {ctx,calls,node,form,submit:()=>node('#accountPassword').submit({preventDefault(){},currentTarget:form})};
}
test('password change validates confirmation and supplies current password to Auth before global signout',async()=>{
  const h=passwordHarness();h.form.elements.confirmation.value='mismatch';await h.submit();assert.equal(h.calls.length,0);
  h.form.elements.confirmation.value='new-password-123';await h.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[['update',{password:'new-password-123',current_password:'old-password'}],['reset'],['signOut',{scope:'global'}]]);
  assert.equal(h.ctx.accountActionBusy,false);
});
test('rejected password update keeps the form and session for correction',async()=>{
  const h=passwordHarness({message:'Wrong password'});await h.submit();
  assert.equal(h.calls.length,1);assert.match(h.node('#accountStatus').textContent,/Password not changed/);
  assert.equal(h.node('submit').disabled,false);
});
function inviteHarness(enabled=true,delivery='ok',reservationError=null){
  let handler;const calls=[];
  const db={rpc:async(name,args)=>{calls.push(['reserve',name,args]);return {data:{email:'owner@example.invalid'},error:reservationError};},
    auth:{admin:{inviteUserByEmail:async(email,options)=>{calls.push(['send',email,options]);if(delivery==='throw')throw Error('network');return {error:delivery==='failed'?{status:400,code:'email_invalid'}:null};}}},
    from:()=>({update:values=>{calls.push(['save',values]);return {eq:()=>({eq:async()=>({})})};}})};
  const ctx=vm.createContext({Request,Response,Date,console,Deno:{env:{get:()=>enabled?'true':undefined},serve:fn=>{handler=fn;}}});
  vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../supabase/functions/commissioner-api/index.ts'),'utf8').replace(/^import .*;\r?\n/gm,'')),ctx);
  ctx.context=async()=>({db,user:{id:'verified-actor'},league:{id:'verified-league'},season:{id:'season'}});
  return {calls,post:()=>handler(new Request('https://example.invalid',{method:'POST',body:JSON.stringify({action:'invite_owner',owner_id:'11111111-1111-4111-8111-111111111111',email:'forged@example.invalid'})}))};
}
test('invitations are disabled until configured and reservation failures never send email',async()=>{
  const h=inviteHarness(false);assert.equal((await h.post()).status,503);assert.equal(h.calls.length,0);
  const duplicate=inviteHarness(true,'ok',{message:'invitation_delivery_needs_review'});assert.equal((await duplicate.post()).status,409);assert.equal(duplicate.calls.length,1);
});
test('invitation sends only to the reserved private address with the fixed site redirect',async()=>{
  const h=inviteHarness();assert.equal((await h.post()).status,200);
  assert.equal(h.calls[1][1],'owner@example.invalid');assert.equal(h.calls[1][2].redirectTo,'https://dushamers.com/?account=setup');
  assert.equal(h.calls[2][1].invite_status,'SENT');
});
test('ambiguous email delivery is recorded for review instead of silently retried',async()=>{
  const h=inviteHarness(true,'throw');assert.equal((await h.post()).status,503);
  assert.equal(h.calls.filter(c=>c[0]==='send').length,1);assert.equal(h.calls[2][1].invite_status,'UNKNOWN');
});
