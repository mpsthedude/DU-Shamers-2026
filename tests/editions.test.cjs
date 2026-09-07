const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const {stripTypeScriptTypes}=require('node:module');
const ctx=vm.createContext({});
vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../supabase/functions/_shared/editions.ts'),'utf8').replace(/^export /gm,'')),ctx);
function facts(){return Array.from({length:12},(_,i)=>({team_id:String(i+1),team_name:'Team '+(i+1),score:i,weekly_rank:12-i}));}
test('draft covers every team without changing facts or calling a provider',()=>{
  const f=facts(), before=JSON.stringify(f), result=ctx.draftEdition(f,1);
  assert.equal(result.length,12);assert.equal(new Set(result.map(e=>e.team_id)).size,12);assert.equal(JSON.stringify(f),before);
  for(const e of result){assert.ok(e.prose.length>80);assert.doesNotMatch(e.prose,/[0-9]/);}
});
test('Supreme Leader receives favorable prose even at the bottom of the table',()=>{
  const f=facts();f[2].weekly_rank=12;f[2].score=-10;
  const prose=ctx.draftEdition(f,2).find(e=>e.team_id==='3').prose;
  assert.match(prose,/vision remains flawless/);assert.equal(f[2].score,-10);
  f[2].weekly_rank=1;assert.match(ctx.draftEdition(f,3)[2].prose,/visionary roster management/);
});
test('invalid and incomplete fact sets cannot generate an edition',()=>{
  assert.throws(()=>ctx.draftEdition(facts().slice(1),1));
  const f=facts();f[0].score=null;assert.throws(()=>ctx.draftEdition(f,1));
});
test('commissioner editor escapes HTML and locks the Supreme Leader field',()=>{
  const c=vm.createContext({escapeMemberText:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../editions.js'),'utf8'),c);
  const f=facts();f[0].team_name='<script>bad</script>';
  const html=c.commissionerEditionMarkup({edition_weeks:[1],editions:[{id:'fixture',week:1,revision:1,status:'DRAFT',facts:f,entries:f.map(f=>({team_id:f.team_id,prose:'</textarea><script>bad</script>'}))}]});
  assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/data-edition-team="3" readonly/);
});
test('public archive renders twelve reports as text, marks corrections, and clears on outage',()=>{
  const elements=new Map();
  function element(tag='div'){return {tagName:tag,children:[],textContent:'',value:'',appendChild(v){this.children.push(v);},
    replaceChildren(){this.children=[];},setAttribute(){},addEventListener(){}};}
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const c=vm.createContext({Date,document:{querySelector:get,createElement:element}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../editions.js'),'utf8'),c);
  const f=facts();f[0].team_name='<script>name</script>';
  c.renderWeeklyEditions([{id:'published',week:1,revision:1,published_at:'2026-09-15T14:00Z',source_changed:true,facts:f,
    entries:f.map(f=>({team_id:f.team_id,prose:'<script>prose</script>'}))}]);
  const content=get('#editionContent'), details=content.children.find(e=>e.tagName==='details'),grid=details.children[1];
  assert.equal(grid.children.length,12);assert.match(content.children[2].textContent,/changed/);
  assert.equal(grid.children[0].children[2].textContent,'<script>prose</script>');
  c.renderWeeklyEditions(null);assert.equal(get('#editionArchive').children.length,0);assert.equal(content.children.length,1);
  assert.match(content.children[0].textContent,/unavailable/);
});
test('public API reads published editions only and never invokes generation or a provider',async()=>{
  const rows={seasons:[{id:'season',year:2026,'leagues.name':'DU Shamers'}],weekly_awards:[],bets:[],ledger_transactions:[],
    league_standings_snapshots:[{id:'snapshot',season_id:'season',observed_at:new Date().toISOString(),payload:{teams:[{team_id:'1',team_name:'Team'}],completed_weeks:[{week:1,scores:[{team_id:'1',score:99}]}]}}],
    weekly_editions:[{id:'published',season_id:'season',status:'PUBLISHED',week:1,revision:1,facts:[{team_id:'1',team_name:'Team',score:10}],entries:[],published_at:'2026-09-15'},
      {id:'private-draft',season_id:'season',status:'DRAFT',entries:[{prose:'private-draft-prose'}]}]};
  let handler;const rpcCalls=[];
  const db={rpc:async name=>{rpcCalls.push(name);return {data:[]};},from:table=>{
    let filtered=rows[table]||[], fields;
    const result=()=>({data:filtered.map(row=>fields?Object.fromEntries(fields.split(',').map(k=>[k,row[k]])):row)});
    const q={select(s){fields=s.includes('!inner')?null:s;return q;},eq(k,v){filtered=filtered.filter(r=>r[k]===v);return q;},order(){return q;},limit(){return q;},
      single:async()=>({data:result().data[0]}),maybeSingle:async()=>({data:result().data[0]}),then(resolve){return Promise.resolve(result()).then(resolve);}};return q;
  }};
  const c=vm.createContext({Date,Response,createClient:()=>db,Deno:{env:{get:()=> 'server-only'},serve:fn=>handler=fn},
    fetch:()=>{throw new Error('Unexpected provider request');}});
  vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../supabase/functions/league-dashboard/index.ts'),'utf8').replace(/^import .*;\r?\n/gm,'')),c);
  const result=await (await handler({method:'GET'})).json();
  assert.equal(result.editions.length,1);assert.equal(result.editions[0].source_changed,true);
  assert.doesNotMatch(JSON.stringify(result),/private-draft/);assert.deepEqual(rpcCalls,['league_team_earnings']);
});
