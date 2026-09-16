const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const code=fs.readFileSync('supabase/functions/commissioner-api/index.ts','utf8');
const fn=vm.runInNewContext(stripTypeScriptTypes(code.slice(code.indexOf('async function ownerRegistrationStatus'),code.indexOf('async function namesByProfile')))+';ownerRegistrationStatus');
test('registration status uses verified auth identity and exposes only status fields',async()=>{
 const owners=[{email:'A@example.com'},{email:'b@example.com'},{email:'c@example.com'}];
 const result=await fn({auth:{admin:{listUsers:async()=>({data:{users:[{email:'a@example.com',email_confirmed_at:'verified',last_sign_in_at:'login',private_field:'secret'},{email:'b@example.com',email_confirmed_at:null}]}})}}},owners);
 assert.deepEqual(Array.from(result,x=>x.registration_status),['REGISTERED','PENDING','NOT_REGISTERED']);assert.equal(result[0].last_sign_in_at,'login');assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('auth lookup failure is unknown rather than not registered',async()=>{
 const result=await fn({auth:{admin:{listUsers:async()=>({error:{message:'failure'}})}}},[{email:'a@example.com'}]);assert.equal(result[0].registration_status,'UNKNOWN');
});
