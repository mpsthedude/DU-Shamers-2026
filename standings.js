function renderLeagueStandings(data) {
  const rows=document.querySelector('#standingsRows'), moneyRows=document.querySelector('#standingsMoneyRows');
  if(!rows || !moneyRows)return;
  const status=document.querySelector('#standingsStatus'), phase=document.querySelector('#standingsPhase');
  const method=document.querySelector('#standingsMethod'), unattributed=document.querySelector('#standingsUnattributed');
  rows.replaceChildren(); moneyRows.replaceChildren(); unattributed.textContent='';
  if(!data || !Array.isArray(data.teams) || !data.teams.length){
    const row=document.createElement('tr'), cell=document.createElement('td');
    cell.colSpan=9;cell.textContent='League standings are unavailable. The commissioner can refresh the saved ESPN snapshot.';
    row.appendChild(cell);rows.appendChild(row);status.textContent='No verified league snapshot available.';
    phase.textContent='Awaiting ESPN';method.textContent='Power ranks require complete scoring weeks.';return;
  }
  const completed=data.completed_weeks || [];
  phase.textContent=completed.length ? completed.length+' completed weeks' : 'Awaiting Week 1 results';
  status.textContent=(data.stale?'Saved snapshot needs a refresh · ':'ESPN snapshot · ')+new Date(data.observed_at).toLocaleString()+
    ' · records and points as reported by ESPN'+(data.omitted_weeks?.length?' · incomplete weeks excluded: '+data.omitted_weeks.join(', '):'');
  method.textContent=data.methodology+' Top-score weeks include tied high scores and do not imply a cash award. No rank is assigned before a complete week.';
  const available=Array.isArray(data.earnings), earnings=new Map((data.earnings||[]).filter(e=>e.team_id!=null).map(e=>[String(e.team_id),e]));
  const cash=v=>v==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v)/100);
  const points=v=>v==null?'—':Number(v).toFixed(2);
  const teams=[...data.teams].sort((a,b)=>(a.power_rank??999)-(b.power_rank??999)||Number(a.team_id)-Number(b.team_id));
  const append=(target,values)=>{
    const row=document.createElement('tr');
    values.forEach((value,index)=>{const cell=document.createElement(index===1 && target===rows?'th':'td');
      if(cell.tagName==='TH')cell.scope='row';cell.textContent=String(value);row.appendChild(cell);});
    target.appendChild(row);
  };
  for(const team of teams){
    const e=earnings.get(String(team.team_id));
    const amount=key=>available?(e?.[key]??0):null;
    const top=completed.filter(w=>{const scores=w.scores||[], own=scores.find(s=>s.team_id===team.team_id);return own && own.score===Math.max(...scores.map(s=>s.score));}).length;
    const record=[team.wins,team.losses,team.ties].some(v=>v==null)?'—':[team.wins,team.losses,team.ties].join('–');
    append(rows,[team.power_rank??'—',team.team_name,record,points(team.points_for),points(team.points_against),
      team.all_play_percentage==null?'—':(team.all_play_percentage*100).toFixed(1)+'%',top,cash(amount('cash_allocated_cents')),cash(amount('net_contribution_cents'))]);
    append(moneyRows,[team.team_name,cash(amount('gross_return_cents')),cash(amount('open_stake_cents')),cash(amount('open_potential_cents'))]);
  }
  const unknown=(data.earnings||[]).filter(e=>e.team_id==null || !teams.some(t=>t.team_id===String(e.team_id)));
  const gross=unknown.reduce((s,e)=>s+Number(e.gross_return_cents||0),0), net=unknown.reduce((s,e)=>s+Number(e.net_contribution_cents||0),0);
  const open=unknown.reduce((s,e)=>s+Number(e.open_potential_cents||0),0);
  unattributed.textContent=available?'Unattributed league positions: '+cash(gross)+' settled returns · '+cash(net)+' net · '+cash(open)+' open potential.':'Team earnings are currently unavailable.';
}
