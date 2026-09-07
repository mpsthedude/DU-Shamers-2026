const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
function render(bets,season={futures_budget_cents:40000,futures_remaining_cents:0}){
 const nodes=Object.fromEntries(['futureGrid','futuresStatus','futuresSummary'].map(id=>[id,{innerHTML:'',textContent:''}]));
 const ctx=vm.createContext({document:{getElementById:id=>nodes[id]},Intl,formatOdds:n=>n>0?'+'+n:String(n)});
 vm.runInContext(source.slice(source.indexOf('function renderFutures('),source.indexOf('function renderLedger(')),ctx);
 ctx.renderFutures(bets,season);return nodes;
}
const bets=[['Detroit Lions',10000,1900,200000],['LSU',10000,1400,150000],['Minnesota Vikings',5000,5000,255000],['Dallas Cowboys',5000,2500,130000],['Cincinnati Bengals',10000,850,95000]].map(([description,stake_cents,placed_american_odds,potential_return_cents])=>({description,stake_cents,placed_american_odds,potential_return_cents,category:'FUTURE',status:'OPEN'}));
test('all five recorded futures display and stakes reconcile without aggregating incompatible payouts',()=>{
 const r=render([...bets,{category:'WEEKLY',stake_cents:10000}]);
 assert.equal((r.futureGrid.innerHTML.match(/<article/g)||[]).length,5);
 assert.match(r.futuresSummary.textContent,/\$400.00 staked.*\$0.00 remaining/);
 assert.equal(r.futuresStatus.textContent,'5 open · 5 total');
 for(const amount of ['2,000','1,500','2,550','1,300','950'])assert.ok(r.futureGrid.innerHTML.includes('$'+amount+'.00'));
 assert.doesNotMatch(r.futureGrid.innerHTML,/Sample|sparkline|8,300/);
});
test('settled zero return, escaped text and empty/unavailable states remain accurate',()=>{
 const r=render([{...bets[0],status:'LOST',settlement_return_cents:0,description:'<img src=x>',market_label:'<script>'}]);
 assert.match(r.futureGrid.innerHTML,/Official return.*?<\/span><strong>\$0.00/s);
 assert.match(r.futureGrid.innerHTML,/&lt;img/);assert.doesNotMatch(r.futureGrid.innerHTML,/<img|<script/);
 assert.match(render([]).futureGrid.innerHTML,/No season-long/);
 assert.equal(render(null).futuresStatus.textContent,'Positions unavailable');
 assert.equal(render(undefined).futuresStatus.textContent,'Loading positions');
});
