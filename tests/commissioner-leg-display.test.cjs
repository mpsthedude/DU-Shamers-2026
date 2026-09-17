const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('auth.js','utf8');
const fn=vm.runInNewContext(code.slice(code.indexOf('function commissionerLegMarkup'),code.indexOf('function testTicketsMarkup'))+';commissionerLegMarkup',{escapeMemberText:s=>String(s).replaceAll('<','&lt;'),formatOdds:String});
test('commissioner total identifies matchup, sport, line, odds and timing',()=>{
 const html=fn({event_name:'Washington Commanders @ Dallas Cowboys',sport:'NFL',selection:'Game · Over/Under · over 50.5',american_odds:-108,event_start_at:'2026-09-20T20:25:00Z',observed_at:'2026-09-17T16:19:19Z'});
 for(const expected of ['Washington Commanders @ Dallas Cowboys','NFL','over 50.5','-108','Starts','checked','Confirm current odds'])assert.ok(html.includes(expected),expected);
});
test('missing metadata is explicit and matchup text is escaped',()=>{
 const html=fn({event_name:'<script>',selection:'Over 50.5',american_odds:null});assert.ok(html.includes('&lt;script>'));assert.ok(html.includes('Odds unavailable'));assert.ok(html.includes('Starts Unavailable'));
});
