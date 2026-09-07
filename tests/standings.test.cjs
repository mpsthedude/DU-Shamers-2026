const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const ctx=vm.createContext({});
vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../supabase/functions/_shared/standings.ts'),'utf8').replace(/^export /gm,'')),ctx);
function fixture(){
  const teams=Array.from({length:12},(_,i)=>({id:i+1,name:'Team '+(i+1),owners:['private-owner'],
    record:{overall:{wins:1,losses:0,ties:0,pointsFor:12-i,pointsAgainst:i}}}));
  const schedule=Array.from({length:6},(_,i)=>({matchupPeriodId:1,winner:'HOME',
    home:{teamId:2*i+1,pointsByScoringPeriod:{1:12-2*i}},
    away:{teamId:2*i+2,pointsByScoringPeriod:{1:11-2*i}}}));
  return {id:290466,seasonId:2026,scoringPeriodId:2,teams,schedule,settings:{scheduleSettings:{matchupPeriods:{1:[1],2:[2]}}}};
}
test('all-play uses each other team once and strips ESPN owner data',()=>{
  const p=fixture();p.schedule.push(p.schedule[0]);
  const result=ctx.normalizeStandings(p);
  assert.equal(result.teams[0].all_play_wins,11);assert.equal(result.teams[0].all_play_comparisons,11);
  assert.equal(result.teams[0].power_rank,1);assert.equal(result.teams[11].power_rank,12);
  assert.doesNotMatch(JSON.stringify(result),/private-owner|owners/);
});
test('tied all-play percentages share ranks and skip the next position',()=>{
  const p=fixture();p.schedule[0].away.pointsByScoringPeriod[1]=12;
  const result=ctx.normalizeStandings(p);
  assert.equal(result.teams[0].power_rank,1);assert.equal(result.teams[1].power_rank,1);assert.equal(result.teams[2].power_rank,3);
  assert.equal(result.teams[0].all_play_ties,1);
});
test('live, incomplete and conflicting weeks do not create rankings',()=>{
  for(const change of [
    p=>p.scoringPeriodId=1,p=>p.schedule[0].winner='UNDECIDED',
    p=>delete p.schedule[0].home.pointsByScoringPeriod[1],
    p=>p.schedule.push({...p.schedule[0],home:{teamId:1,pointsByScoringPeriod:{1:999}}}),
  ]){
    const p=fixture();change(p);const result=ctx.normalizeStandings(p);
    assert.equal(result.completed_weeks.length,0);assert.equal(result.teams[0].power_rank,null);
  }
});
test('multi-week matchups use weekly scores instead of cumulative totals',()=>{
  const p=fixture();p.scoringPeriodId=3;p.settings.scheduleSettings.matchupPeriods={1:[1,2]};
  for(const m of p.schedule)for(const s of [m.home,m.away]){s.pointsByScoringPeriod[2]=100;s.totalPoints=999;}
  const result=ctx.normalizeStandings(p);
  assert.equal(result.completed_weeks.length,2);assert.equal(result.teams[0].all_play_comparisons,22);
  assert.equal(result.teams[0].all_play_percentage,0.75);
});
test('standings renderer treats names as text and clears stale rows on outage',()=>{
  const elements=new Map();
  function element(tag='div'){return {tagName:tag.toUpperCase(),children:[],textContent:'',appendChild(v){this.children.push(v);},
    replaceChildren(){this.children=[];}};}
  const get=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
  const local=vm.createContext({Intl,Date,document:{querySelector:get,createElement:element}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../standings.js'),'utf8'),local);
  const payload=ctx.normalizeStandings(fixture());payload.teams[0].team_name='<img src=x onerror=bad()>';
  local.renderLeagueStandings({...payload,observed_at:'2026-09-07T13:00Z',earnings:[]});
  assert.equal(get('#standingsRows').children.length,12);
  assert.equal(get('#standingsRows').children[0].children[1].textContent,'<img src=x onerror=bad()>');
  local.renderLeagueStandings(null);
  assert.equal(get('#standingsRows').children.length,1);assert.equal(get('#standingsMoneyRows').children.length,0);
});
