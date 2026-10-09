const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/trip-photos/index.ts','utf8').replace(/^import .*;\r?\n/,''));
function handler({user=null,member=null}={}){
 let serve,uploads=0;const db={auth:{getUser:async()=>({data:{user}})},from(table){const q={select(){return q},eq(){return q},ilike(){return q},limit(){return q},single:async()=>({data:{id:'league'}}),maybeSingle:async()=>({data:member})};return q;},storage:{from(){return {list:async()=>({data:[]}),upload:async()=>{uploads++;return{}},getPublicUrl:()=>({data:{publicUrl:'https://example.test/photo.jpg'}})};}}};
 vm.runInNewContext(source,{createClient:()=>db,Deno:{env:{get:()=>''},serve:fn=>serve=fn},Response,Uint8Array,crypto,URL});return {run:serve,uploads:()=>uploads};
}
const request=(headers={},body=new Uint8Array([255,216,255,217]))=>new Request('https://example.test',{method:'POST',headers,body});
test('anonymous visitors can browse and upload JPEG photos',async()=>{const h=handler();assert.equal((await h.run(new Request('https://example.test'))).status,200);assert.equal((await h.run(request({'content-type':'image/jpeg'}))).status,201);assert.equal(h.uploads(),1)});
test('public uploads reject arbitrary files and oversized data',async()=>{const h=handler({user:{id:'id',email:'x',email_confirmed_at:'today'},member:{id:'member'}});assert.equal((await h.run(request({'content-type':'image/jpeg'}))).status,201);assert.equal((await h.run(request({'content-type':'text/html'}))).status,415);assert.equal((await h.run(request({'content-type':'image/jpeg'},new Uint8Array([1,2,3,4])))).status,415);assert.equal((await h.run(request({'content-type':'image/jpeg','content-length':'7000000'}))).status,413);assert.equal(h.uploads(),1);});
test('invalid pagination and unsupported methods are rejected',async()=>{const h=handler();assert.equal((await h.run(new Request('https://example.test?offset=-1'))).status,400);assert.equal((await h.run(new Request('https://example.test',{method:'DELETE'}))).status,405);});
