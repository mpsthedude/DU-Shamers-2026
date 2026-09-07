// Loaded only by scripts/practice-server.cjs. No production build includes this file.
(() => {
  const localFetch=window.fetch.bind(window);
  let recordedAnalysis=null;
  let role = 'OWNER', proposal = null, bet = null, cash = 0, spent = 0, bonus = 0, lockedChoice = null;
  const ledger = [];
  let viewer='winner';
  let trackerPhase='live';
  function trackerSnapshot(){
    if(!bet)return {sample:true,tickets:[]};
    const phase=trackerPhase==='delayed'?'live':trackerPhase;
    const fixtureLegs=proposal?.legs || [{selection:'Sample Home ML',event_name:'Sample Away @ Sample Home'},{selection:'Sample Quarterback Passing Yards Over 249.5',event_name:'Sample Away @ Sample Home',stat_id:'passing_yards',line:249.5,side:'over'}];
    const current=phase==='upcoming'?null:phase==='finished'?268:187;
    return {sample:true,delayed:trackerPhase==='delayed',observed_at:new Date(Date.now()-(trackerPhase==='delayed'?600000:0)).toISOString(),tickets:[{
      week:1,owner:award.fantasy_team_name,status:bet?.status||'OPEN',phase,
      stake_cents:bet?.stake_cents??5000,odds:bet?.placed_american_odds??200,potential_return_cents:bet?.potential_return_cents??15000,settlement_return_cents:bet?.status==='LOST'?0:bonus,
      legs:fixtureLegs.map(leg=>({selection:leg.selection,event_name:leg.event_name,clock:phase==='upcoming'?'Scheduled Sunday':phase==='finished'?'Final':'Q3 · 06:42',score:phase==='upcoming'?null:phase==='finished'?'Away 21 · Home 28':'Away 14 · Home 17',current:leg.stat_id?current:null,target:leg.stat_id?leg.line:null,unit:leg.stat_id?.includes('yards')?'yards':'',side:leg.side,note:phase==='finished'?'Game finished; awaiting commissioner confirmation':'Sample progress; not a settled result'}))
    }]};
  }
  const matchups = {
    NFL: [['Denver Broncos','Los Angeles Chargers'],['Buffalo Bills','Baltimore Ravens'],['Kansas City Chiefs','Las Vegas Raiders'],['Dallas Cowboys','Philadelphia Eagles'],['Green Bay Packers','Chicago Bears'],['Detroit Lions','Minnesota Vikings'],['San Francisco 49ers','Seattle Seahawks'],['Los Angeles Rams','Arizona Cardinals'],['New York Giants','Washington Commanders'],['Miami Dolphins','New England Patriots'],['New York Jets','Pittsburgh Steelers'],['Cleveland Browns','Cincinnati Bengals'],['Houston Texans','Indianapolis Colts'],['Jacksonville Jaguars','Tennessee Titans'],['Atlanta Falcons','Carolina Panthers'],['New Orleans Saints','Tampa Bay Buccaneers']],
    NCAAF: [['Arizona State Sun Devils','Arizona Wildcats'],['LSU Tigers','Florida Gators'],['Alabama Crimson Tide','Georgia Bulldogs'],['Ohio State Buckeyes','Michigan Wolverines'],['Texas Longhorns','Oklahoma Sooners'],['Oregon Ducks','Washington Huskies'],['Penn State Nittany Lions','USC Trojans'],['Notre Dame Fighting Irish','Clemson Tigers']]
  };
  matchups.NCAAF.push(...Array.from({length:48},(_,i)=>[`Practice College ${String(i*2+1).padStart(2,'0')}`,`Practice College ${String(i*2+2).padStart(2,'0')}`]));
  function practiceGames(league){return (matchups[league]||[]).map(([away,home],i)=>({
    event_id:`practice-${league}-${i}`,league,away:{name:away},home:{name:home},
    starts_at:new Date(Date.now()+(league==='NFL' && i===15?9:2+i%4)*86400000).toISOString(),
    odds:[{odd_id:'points-home-game-ml-home',odds:150},{odd_id:'points-away-game-ml-away',odds:-175},
      {odd_id:'points-home-game-sp-home',odds:-110,spread:3.5},{odd_id:'points-away-game-sp-away',odds:-110,spread:-3.5},
      {odd_id:'points-all-game-ou-over',odds:-110,over_under:47.5},{odd_id:'points-all-game-ou-under',odds:-110,over_under:47.5}]
  }));}
  const award = {id:'practice-award',week:1,fantasy_team_id:'3',fantasy_team_name:'Supreme Leader (practice)',score:145.5,source_status:'WINNER_IDENTIFIED'};
  const session = {access_token:'local-practice-only',user:{id:'practice-owner',email:'practice@example.invalid'}};
  // The real Supabase SDK is replaced, never initialized with a session.
  window.supabase = {createClient:()=>({auth:{getSession:async()=>({data:{session:viewer==='guest'?null:session}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>{viewer='guest';await refreshMemberState();paint();}}})};
  const reply = (data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  const money = value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
  const row = (account,amount,description)=>ledger.unshift({account,amount_cents:amount,description,occurred_at:new Date().toISOString()});
  function paint(){
    const summary=document.getElementById('practiceSummary');
    if(summary)summary.textContent=`Viewing as ${viewer} · Cash ${money(cash)} · Weekly remaining ${money(140000-cash-spent)} · Bonus bank ${money(bonus)} · Ticket ${bet?.status || proposal?.status || 'not submitted'}`;
    const selector=document.getElementById('practiceViewer');if(selector)selector.value=viewer;
  }
  window.fetch = async(input,options={})=>{
    const url=new URL(String(input),location.href), endpoint=url.pathname.split('/').pop();
    const body=options.body?JSON.parse(options.body):null;
    if(endpoint==='analyze-ticket'){
      if(recordedAnalysis && body?.legs?.length===1 && body.legs[0].event_id===recordedAnalysis.leg.event_id && body.legs[0].odd_id===recordedAnalysis.leg.odd_id && Number(body.legs[0].odds)===recordedAnalysis.leg.odds)return reply(recordedAnalysis.analysis);
      return reply({error:'load_recorded_analysis_ticket'},400);
    }
    if(endpoint==='draftkings-event-props'){
      const id=url.searchParams.get('event_id'), event=practiceGames('NFL').find(e=>e.event_id===id);
      if(!event)return reply({error:'event_not_found'},404);
      const scenario=document.getElementById('practicePropsMode')?.value || 'normal';
      if(scenario==='outage')return reply({error:'practice_provider_unavailable'},503);
      const props=scenario==='empty'?[]:[['Sample Quarterback','QB','passing_yards',249.5],['Sample Running Back','RB','rushing_yards',64.5],['Sample Receiver','WR','receiving_yards',74.5],['Sample Receiver','WR','receiving_receptions',5.5]].flatMap(([name,position,stat,line],i)=>['over','under'].map(side=>({odd_id:`${stat}-practice_player_${i}-game-ou-${side}`,player_id:`practice_player_${i}`,player_name:name,position,stat_id:stat,bet_type:'ou',side,line,odds:-110})));
      return reply({event_id:id,league:'NFL',starts_at:event.starts_at,props,provider_cache:{oldest_observed_at:new Date().toISOString()}});
    }
    if(endpoint==='member-api'){
      if(viewer==='guest')return reply({error:'member_sign_in_required'},401);
      if(body){
        if(viewer!=='winner')return reply({error:'not_this_weeks_high_scorer'},403);
        if(body.action!=='submit_weekly_bet')return reply({error:'practice_action_unavailable'},400);
        if(proposal && proposal.status!=='REJECTED')return reply({error:'weekly_ticket_already_submitted'},409);
        if(lockedChoice && lockedChoice!==body.choice)return reply({error:'weekly_decision_already_locked'},409);
        if(!['split','ride'].includes(body.choice) || !body.legs?.length)return reply({error:'invalid_ticket'},400);
        if(!lockedChoice){cash=body.choice==='split'?5000:0;if(cash)row('CASH_PAYOUTS',cash,'Practice weekly cash award');lockedChoice=body.choice;}
        proposal={id:'practice-proposal',status:'AWAITING_COMMISSIONER_PLACEMENT',proposed_stake_cents:body.choice==='split'?5000:10000,estimated_american_odds:body.estimated_american_odds,submitted_at:new Date().toISOString(),submitter:{fantasy_team_name:award.fantasy_team_name},legs:body.legs.map(leg=>({...leg,american_odds:leg.odds}))};
        paint();return reply({proposal});
      }
      const used=Number(document.getElementById('practiceAnalysisUsed')?.value||0);
      return reply({analysis_usage:{limit:5,used,remaining:5-used,enabled:true},membership:{role,fantasy_team_id:viewer==='winner'?'3':'2',fantasy_team_name:viewer==='winner'?award.fantasy_team_name:'Another owner (practice)'},current_award:award,current_proposal:viewer==='winner'?proposal:null,eligible_weekly_winner:viewer==='winner',submission_window_open:true});
    }
    if(endpoint==='commissioner-api'){
      if(role!=='COMMISSIONER')return reply({error:'commissioner_not_authorized'},403);
      if(body){
        if(body.action==='reject_proposal' && proposal?.status==='AWAITING_COMMISSIONER_PLACEMENT')proposal.status='REJECTED';
        else if(body.action==='confirm_placement' && proposal?.status==='AWAITING_COMMISSIONER_PLACEMENT'){
          const odds=Number(body.placed_american_odds);
          if(!Number.isInteger(odds)||Math.abs(odds)<100)return reply({error:'invalid_american_odds'},400);
          spent=proposal.proposed_stake_cents;
          bet={id:'practice-bet',category:'WEEKLY',status:'OPEN',stake_cents:spent,placed_american_odds:odds,potential_return_cents:Math.round(spent*(odds>0?1+odds/100:1+100/Math.abs(odds))),sportsbook_ticket_ref:body.sportsbook_ticket_ref};
          proposal.status='PLACED';row('WEEKLY_ALLOCATION',-spent,'Practice DraftKings placement');
        }else if(body.action==='settle_bet' && bet?.status==='OPEN' && ['WON','LOST','PUSHED'].includes(body.status)){
          bet.status=body.status;bonus=body.status==='WON'?bet.potential_return_cents:body.status==='LOST'?0:bet.stake_cents;
          row('BONUS_BANK',bonus,'Practice settlement: '+body.status);
        }else return reply({error:'practice_action_unavailable'},400);
        paint();return reply({ok:true});
      }
      return reply({claims:[],proposals:proposal?[proposal]:[],bets:bet?[bet]:[],owners:[]});
    }
    if(endpoint==='league-dashboard')return reply({weekly_tracker:trackerSnapshot(),bonus_bank_cents:bonus,season:{weekly_remaining_cents:140000-cash-spent,futures_remaining_cents:40000,cash_payouts_cents:cash,weekly_spent_cents:spent},current_award:award,ledger,standings:null,editions:[]});
    if(endpoint==='draftkings-markets')return reply({events:practiceGames(url.searchParams.get('league')),coverage:{complete:true}});
    // Fail closed: no fallback to the original fetch, including paid analysis and email.
    return reply({error:'practice_action_unavailable'},503);
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const banner=document.createElement('aside');banner.style.cssText='position:sticky;top:0;z-index:1000;background:#fff3cd;color:#29210b;padding:12px;border-bottom:3px solid #9a6700';
    banner.innerHTML='<strong>LOCAL PRACTICE — all matchups, dates, odds, scores and money are fabricated.</strong><p>Search 16 NFL and 56 college matchups. College shows 20 at a time; search finds games beyond those visible. Choose a payout, add selections and submit.</p><button id="practiceRole">Switch to commissioner</button> <button id="practiceReset">Reset practice</button><p id="practiceSummary" aria-live="polite"></p>';
    document.body.prepend(banner);
    const usageLabel=document.createElement('label');usageLabel.textContent=' Simulated analyses used: ';
    const usageSelect=document.createElement('select');usageSelect.id='practiceAnalysisUsed';usageSelect.setAttribute('aria-label','Simulated analyses used');
    usageSelect.innerHTML=[0,1,2,3,4,5].map(n=>`<option value="${n}">${n}</option>`).join('');usageSelect.onchange=()=>refreshMemberState({refreshCommissioner:false});usageLabel.append(usageSelect);banner.append(usageLabel);
    const analysisButton=document.createElement('button');analysisButton.textContent='Load live-data analysis test';
    analysisButton.onclick=async()=>{
      try{
        const response=await localFetch('/recorded-analysis.json');if(!response.ok)throw Error('No recorded test');recordedAnalysis=await response.json();
        const leg=recordedAnalysis.leg;state.choice='split';state.legs=[{...leg,id:leg.event_id+':'+leg.odd_id,eventId:leg.event_id,providerEventId:leg.event_id,providerOddId:leg.odd_id,eventName:leg.event_name,eventStartAt:leg.event_start_at,sport:'NFL'}];
        renderChoice();renderSlip();document.getElementById('builder').scrollIntoView();showToast('Recorded live-data ticket loaded. Click Analyze my ticket. Replays make no paid calls.');
      }catch(error){showToast('Recorded analysis test unavailable.');}
    };banner.append(analysisButton);
    const viewLabel=document.createElement('label');viewLabel.textContent=' View as: ';
    const viewSelect=document.createElement('select');viewSelect.id='practiceViewer';viewSelect.setAttribute('aria-label','Simulation viewer');
    viewSelect.innerHTML='<option value="winner">Weekly winner</option><option value="owner">Another owner</option><option value="guest">Guest</option><option value="commissioner">Commissioner</option>';
    viewSelect.onchange=async()=>{viewer=viewSelect.value;role=viewer==='commissioner'?'COMMISSIONER':'OWNER';document.getElementById('practiceRole').textContent=role==='COMMISSIONER'?'Switch to owner':'Switch to commissioner';closeMemberModal();await refreshMemberState();paint();};
    viewLabel.append(viewSelect);banner.append(viewLabel);
    const placedButton=document.createElement('button');placedButton.textContent='Load placed sample ticket';placedButton.id='practicePlaced';
    placedButton.onclick=async()=>{
      cash=5000;spent=5000;bonus=0;lockedChoice='split';ledger.length=0;
      proposal={id:'practice-proposal',status:'PLACED',proposed_stake_cents:5000,submitter:{fantasy_team_name:award.fantasy_team_name},legs:[
        {event_id:'practice-NFL-0',selection:'Los Angeles Chargers ML',american_odds:150,event_name:'Denver Broncos @ Los Angeles Chargers'},
        {event_id:'practice-NFL-0',selection:'Sample Quarterback Passing Yards Over 249.5',american_odds:-110,event_name:'Denver Broncos @ Los Angeles Chargers',stat_id:'passing_yards',line:249.5,side:'over'}]};
      bet={id:'practice-bet',category:'WEEKLY',status:'OPEN',stake_cents:5000,placed_american_odds:200,potential_return_cents:15000};
      row('CASH_PAYOUTS',5000,'Sample cash award');row('WEEKLY_ALLOCATION',-5000,'Sample placed ticket');
      state.legs=[];renderSlip();renderMarkets();paint();await refreshMemberState();await loadLiveLeagueBank();document.getElementById('weeklyTracker').scrollIntoView();
    };banner.append(placedButton);
    const trackerLabel=document.createElement('label');trackerLabel.textContent=' Tracker test: ';
    const trackerSelect=document.createElement('select');trackerSelect.setAttribute('aria-label','Practice tracker state');trackerSelect.innerHTML='<option value="live">Live</option><option value="upcoming">Upcoming</option><option value="delayed">Delayed</option><option value="finished">Finished</option>';
    trackerSelect.onchange=()=>{trackerPhase=trackerSelect.value;loadLiveLeagueBank();};trackerLabel.append(trackerSelect);banner.append(trackerLabel);
    const propMode=document.createElement('label');propMode.textContent=' Prop test: ';
    const modes=document.createElement('select');modes.id='practicePropsMode';modes.setAttribute('aria-label','Practice prop response');modes.innerHTML='<option value="normal">Available props</option><option value="empty">No props</option><option value="outage">Provider outage</option>';
    modes.onchange=()=>{propsCache.clear();if(activePropsEventId)openPlayerProps(activePropsEventId);};propMode.append(modes);banner.append(propMode);
    document.getElementById('practiceRole').onclick=async()=>{role=role==='OWNER'?'COMMISSIONER':'OWNER';viewer=role==='COMMISSIONER'?'commissioner':'winner';document.getElementById('practiceRole').textContent=role==='OWNER'?'Switch to commissioner':'Switch to owner';paint();await refreshMemberState();if(role==='COMMISSIONER')document.getElementById('commissioner').scrollIntoView();};
    document.getElementById('practiceReset').onclick=()=>{localStorage.removeItem('duShamersDemoState');location.reload();};
    paint();
  });
})();
