const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/weekly-publication.ts','utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''));
function harness(options={}) {
  const calls=[];
  const entries=[{team_id:'3',prose:'Verified draft'}];
  const ctx=vm.createContext({draftEdition:()=>entries});vm.runInContext(source,ctx);
  const db={from(table){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},
    async maybeSingle(){return {data:table==='weekly_editions'?(options.published?{id:'published'}:null):{id:'snapshot'}}},
    async single(){return {data:{version:7,entries}}}};return q;},
    async rpc(name,args){calls.push({name,args});
      if(name==='weekly_edition_facts') return {data:[]};
      if(args.p_action==='CREATE') return {data:{edition_id:'draft',replayed:true}};
      return options.failPublish?{error:{message:'failed'}}:{data:{status:'PUBLISHED'}};
    }};
  return {calls,run:()=>ctx.publishScheduledEdition(db,'season',3)};
}
test('scheduled publication preserves existing published prose',async()=>{
  const h=harness({published:true});await h.run();assert.equal(h.calls.length,0);
});
test('new publication uses saved draft version and verified snapshot facts',async()=>{
  const h=harness();await h.run();assert.equal(h.calls.length,3);
  assert.equal(h.calls[0].args.p_snapshot,'snapshot');
  assert.equal(h.calls[1].args.p_action,'CREATE');
  assert.equal(h.calls[2].args.p_action,'PUBLISH');
  assert.equal(h.calls[2].args.p_version,7);
  assert.equal(h.calls[2].args.p_entries[0].prose,'Verified draft');
});
test('publication failure is surfaced for scheduled retry',async()=>{
  await assert.rejects(harness({failPublish:true}).run(),/edition_publish_failed/);
});
