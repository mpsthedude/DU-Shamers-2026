const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {ticketConflict}=require('../ticket-rules.js');
const leg=(id,line=null,event='game')=>({odd_id:id,line,event_id:event});
test('opposing moneylines, equal totals, props and yes/no cannot be combined',()=>{
  for(const pair of [
    [leg('points-home-game-ml-home'),leg('points-away-game-ml-away')],
    [leg('points-all-game-ou-over',45.5),leg('points-all-game-ou-under',45.5)],
    [leg('passing_yards-player-game-ou-over',250),leg('passing_yards-player-game-ou-under',240)],
    [leg('touchdowns-player-game-yn-yes'),leg('touchdowns-player-game-yn-no')],
    [leg('points-home-game-sp-home',-3),leg('points-away-game-sp-away',3)],
    [leg('points-home-game-ml-home'),leg('points-away-game-sp-away',-3)]
  ]) assert.ok(ticketConflict(pair));
});
test('compatible middles, independent games and correlated same-game legs remain selectable',()=>{
  for(const pair of [
    [leg('points-home-game-ml-home'),leg('points-away-game-sp-away',3.5)],
    [leg('points-all-game-ou-over',40),leg('points-all-game-ou-under',50)],
    [leg('points-home-game-ml-home'),leg('points-away-game-ml-away',null,'other')],
    [leg('points-home-game-ml-home'),leg('passing_yards-player-game-ou-over',250)]
  ]) assert.equal(ticketConflict(pair),null);
});
test('browser and server use identical rules, including normalized provider fields',()=>{
  const server=fs.readFileSync('supabase/functions/_shared/ticket-rules.ts','utf8').replace('export function ticketConflict(legs: any[])','function ticketConflict(legs)').trim();
  const browser=fs.readFileSync('ticket-rules.js','utf8').replace("if (typeof module !== 'undefined') module.exports = { ticketConflict };",'').trim();
  assert.equal(server,browser);
  assert.ok(ticketConflict([{providerOddId:'points-home-game-ml-home',providerEventId:'x'},{providerOddId:'points-away-game-ml-away',providerEventId:'x'}]));
});
