const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const ctx=vm.createContext({Date});
vm.runInContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/_shared/futures.ts','utf8')).replace('export function','function'),ctx);
const mapping={bet_id:'b',event_id:'2026-event',sport_key:'afc',outcome_name:'Cincinnati Bengals'};
function events(overrides={}) {return [{id:'2026-event',sport_key:'afc',bookmakers:[{key:'draftkings',last_update:new Date().toISOString(),markets:[{key:'outrights',outcomes:[{name:'Cincinnati Bengals',price:850}]}]}],...overrides}];}
test('futures match only the exact season event, market, book and outcome',()=>{
 assert.equal(ctx.matchFutures(events(),mapping).american_odds,850);
 assert.equal(ctx.matchFutures(events({id:'2027-event'}),mapping),null);
 assert.equal(ctx.matchFutures(events({sport_key:'super-bowl'}),mapping),null);
 const e=events();e[0].bookmakers[0].key='fanduel';assert.equal(ctx.matchFutures(e,mapping),null);
 const h=events();h[0].bookmakers[0].markets[0].key='h2h';assert.equal(ctx.matchFutures(h,mapping),null);
});
test('stale, missing and invalid prices are unavailable, never zero likelihood',()=>{
 const e=events();e[0].bookmakers[0].last_update='2020-01-01';assert.equal(ctx.matchFutures(e,mapping),null);
 const h=events();h[0].bookmakers[0].markets[0].outcomes[0].price=0;assert.equal(ctx.matchFutures(h,mapping),null);
 assert.equal(ctx.matchFutures([],mapping),null);
});
test('market visual distinguishes improved, declined, unavailable and delayed observations',()=>{
 const code=fs.readFileSync('app.js','utf8');const c=vm.createContext({Date,formatOdds:n=>n>0?'+'+n:String(n)});
 vm.runInContext(code.slice(code.indexOf('function renderFuturesTrend('),code.indexOf('function renderLedger(')),c);
 const b={status:'OPEN',placed_american_odds:1900,futures_covered:true,futures_automatic:true,futures_history:[{week:1,american_odds:1400,observed_at:new Date().toISOString()}]};
 assert.match(c.renderFuturesTrend(b),/Improved.*1.67 percentage points/);
 assert.match(c.renderFuturesTrend({...b,futures_history:[{week:1,american_odds:2500,observed_at:'2020-01-01'}],completed_week:2}),/Declined/);
 assert.match(c.renderFuturesTrend({...b,futures_history:[{week:1,american_odds:2500,observed_at:'2020-01-01'}],completed_week:2}),/Weekly update pending/);
 assert.match(c.renderFuturesTrend({...b,futures_history:[],futures_covered:false}),/comparison unavailable/);
});
