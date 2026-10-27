const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const c=vm.createContext({});vm.runInContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/lineup-roasts.ts','utf8').replace(/^export /gm,'')),c);
function fixture(){
 const player=(name,slot,score,eligible)=>({lineupSlotId:slot,playerPoolEntry:{appliedStatTotal:score,player:{fullName:name,eligibleSlots:eligible}}});
 const side=id=>({teamId:id,rosterForCurrentScoringPeriod:{entries:[player('Starter QB',0,10,[0]),player('Starter RB',2,20,[2]),player('Bench QB',20,35,[0]),player('Injured Reserve',21,99,[0]),player('Ineligible TE',20,70,[6])]}});
 const facts=Array.from({length:12},(_,i)=>({team_id:String(i+1),team_name:'Team',score:30}));
 return {facts,payload:{period:7,matchups:Array.from({length:6},(_,i)=>({winner:'TIE',home:side(i*2+1),away:side(i*2+2)}))}};
}
test('historical scores reconcile and bench comparisons respect slot eligibility and exclude IR',()=>{
 const {facts,payload}=fixture();const insights=c.lineupInsights(payload,7,facts);
 assert.equal(insights.length,12);assert.equal(insights[0].swap.bench.name,'Bench QB');assert.equal(insights[0].swap.gain,25);
 const prose=c.playerRoast(insights[0]);assert.match(prose,/Bench QB/);assert.doesNotMatch(prose,/Injured Reserve|Ineligible TE|[0-9]/);
});
test('wrong week, missing rosters and inconsistent scores fail closed',()=>{
 const {facts,payload}=fixture();assert.throws(()=>c.lineupInsights(payload,6,facts),/period/);
 facts[0].score=31;assert.throws(()=>c.lineupInsights(payload,7,facts),/total/);
 facts[0].score=30;delete payload.matchups[0].home.rosterForCurrentScoringPeriod;assert.throws(()=>c.lineupInsights(payload,7,facts),/roster/);
});
test('only a sufficient legal substitution is described as reversing a loss',()=>{
 const {facts,payload}=fixture();const i=c.lineupInsights(payload,7,facts)[0];i.margin=-26;
 assert.doesNotMatch(c.playerRoast(i),/reversed/);i.margin=-24;assert.match(c.playerRoast(i),/reversed/);
 assert.match(c.playerRoast(i,true),/leadership remains beyond reproach/);
});
