const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('ticket review updates matching picks without losing stake or identity',()=>{
 const notice={hidden:true,scrollIntoView(){}};
 const ctx=vm.createContext({state:{choice:'split',legs:[{id:'original',providerEventId:'event',providerOddId:'odd',odds:-110,line:-3,selection:'Dallas -3'}]},pendingWeeklySubmission:{key:'old'},persist(){},renderSlip(){},formatOdds:String,escapeMemberText:String,document:{querySelector:()=>notice}});
 const code=fs.readFileSync('auth.js','utf8').split('function applyTicketUpdates(updated) {')[1].split('async function submitPersistentTicket')[0];
 vm.runInContext('function applyTicketUpdates(updated) {'+code,ctx);
 assert.equal(ctx.applyTicketUpdates([{event_id:'other',odd_id:'odd',american_odds:-115,line_value:-3.5}]),false);
 assert.equal(ctx.state.legs[0].line,-3);
 assert.equal(ctx.applyTicketUpdates([{event_id:'event',odd_id:'odd',american_odds:-115,line_value:-3.5,selection:'Dallas -3.5'}]),true);
 assert.equal(ctx.state.choice,'split');assert.equal(ctx.state.legs[0].id,'original');
 assert.equal(ctx.state.legs[0].line,-3.5);assert.equal(ctx.pendingWeeklySubmission,null);
 assert.equal(notice.hidden,false);assert.match(notice.innerHTML,/Not submitted yet/);assert.match(notice.innerHTML,/Dallas -3.5/);
});
