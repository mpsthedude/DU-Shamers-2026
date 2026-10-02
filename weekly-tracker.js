// Display-only snapshots. This module never calculates official settlement or calls a provider.
function renderWeeklyTracker(snapshot, currentWeek) {
  const root=document.getElementById('weeklyTrackerBody');if(!root)return;
  const allTickets=Array.isArray(snapshot?.tickets)?snapshot.tickets:[];
  const activeWeek=Number(currentWeek)||Math.max(0,...allTickets.map(t=>Number(t.week)||0));
  const isCurrent=t=>Number(t.week)===activeWeek && ['OPEN','PLACED'].includes(t.status);
  const recap=document.getElementById('settledTicketRecap');
  if(recap){
    recap.replaceChildren();
    const completed=allTickets.filter(t=>!isCurrent(t));
    recap.classList.toggle('hidden',!completed.length);
    if(completed.length){
      const details=document.createElement('details');recap.append(details);const heading=document.createElement('summary');heading.textContent='Betting history · '+completed.length+' past tickets';details.append(heading);
      for(const t of completed){
        const row=document.createElement('p');
        const cash=v=>Number.isInteger(v)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v/100):'—';
        const net=Number.isInteger(t.settlement_return_cents)?t.settlement_return_cents-t.stake_cents:null;
        row.textContent='Week '+t.week+' · '+t.owner+' · '+(['OPEN','PLACED'].includes(t.status)?'Awaiting commissioner settlement':t.status)+' · Returned '+cash(t.settlement_return_cents)+' · Net '+cash(net);
        const picks=document.createElement('small');picks.textContent=(t.legs||[]).map(l=>l.selection).join(' + ');row.append(document.createElement('br'),picks);details.append(row);
      }
    }
  }
  const placedTickets=allTickets.filter(isCurrent);
  document.getElementById('weeklyTracker')?.classList.toggle('hidden', !placedTickets.length);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=value=>Number.isInteger(value)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100):'—';
  if(!snapshot){root.innerHTML='<p>Weekly ticket tracking is not connected yet.</p>';return;}
  const tickets=placedTickets;
  if(!tickets.length){root.innerHTML='<p>No placed weekly tickets to track yet.</p>';return;}
  root.innerHTML=tickets.map(ticket=>`
    <article class="weekly-tracked-ticket"><h3>Week ${esc(ticket.week)} · ${esc(ticket.owner)}</h3>
    <p><strong>Placed</strong> · Stake ${money(ticket.stake_cents)} · DK odds ${esc(ticket.odds>0?'+'+ticket.odds:ticket.odds??'—')} · Potential return ${money(ticket.potential_return_cents)}</p>
    <div class="tracked-legs">${(ticket.legs||[]).map(leg=>{
      const kickoff=Number.isFinite(Date.parse(leg.starts_at))?'Kickoff: '+new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(leg.starts_at)):'Kickoff time not confirmed';
      return `<div class="tracked-leg"><strong>${esc(leg.selection)}</strong><p>${esc(leg.event_name)}<br>${esc(kickoff)}</p></div>`;
    }).join('')}</div></article>`).join('');
}
