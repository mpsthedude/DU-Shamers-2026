// Display-only snapshots. This module never calculates official settlement or calls a provider.
function renderWeeklyTracker(snapshot) {
  const root=document.getElementById('weeklyTrackerBody');if(!root)return;
  const recap=document.getElementById('settledTicketRecap');
  if(recap){
    recap.replaceChildren();
    const completed=(snapshot?.tickets||[]).filter(t=>['WON','LOST','PUSHED','VOID'].includes(t.status));
    recap.classList.toggle('hidden',!completed.length);
    if(completed.length){
      const heading=document.createElement('h3');heading.textContent='Weekly bet recap';recap.append(heading);
      for(const t of completed){
        const row=document.createElement('p');
        const cash=v=>Number.isInteger(v)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v/100):'—';
        const net=Number.isInteger(t.settlement_return_cents)?t.settlement_return_cents-t.stake_cents:null;
        row.textContent='Week '+t.week+' · '+t.owner+' · '+t.status+' · Returned '+cash(t.settlement_return_cents)+' · Net '+cash(net);
        const picks=document.createElement('small');picks.textContent=(t.legs||[]).map(l=>l.selection).join(' + ');row.append(document.createElement('br'),picks);recap.append(row);
      }
    }
  }
  const placedTickets=(Array.isArray(snapshot?.tickets)?snapshot.tickets:[]).filter(ticket=>['OPEN','PLACED'].includes(ticket.status));
  document.getElementById('weeklyTracker')?.classList.toggle('hidden', !placedTickets.length);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=value=>Number.isInteger(value)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100):'—';
  if(!snapshot){root.innerHTML='<p>Weekly ticket tracking is not connected yet.</p>';return;}
  const tickets=placedTickets;
  if(!tickets.length){root.innerHTML='<p>No placed weekly tickets to track yet.</p>';return;}
  const hasOpen=tickets.some(t=>!['WON','LOST','PUSHED','VOID'].includes(t.status));
  const observed=Date.parse(snapshot.observed_at),stale=snapshot.delayed || !Number.isFinite(observed) || Date.now()-observed>180000;
  root.innerHTML=(hasOpen?`<p class="tiny-note">${snapshot.sample?'SAMPLE DATA · ':''}${hasOpen&&stale?'Updates delayed · ':''}Last updated: ${Number.isFinite(observed)?esc(new Date(observed).toLocaleString()):'unavailable'}. Progress is informational; the commissioner confirms DraftKings settlement.</p>`:'<p class="tiny-note">Final results confirmed by the commissioner from DraftKings settlement.</p>')+tickets.map(ticket=>{
    const settled=['WON','LOST','PUSHED','VOID'].includes(ticket.status);
    const status=settled?`Official: ${ticket.status}`:ticket.phase==='finished'?'Awaiting commissioner settlement':ticket.phase==='live'?'In progress':'Upcoming';
    return `<article class="weekly-tracked-ticket"><h3>Week ${esc(ticket.week)} · ${esc(ticket.owner)}</h3><p><strong>${esc(status)}</strong> · Stake ${money(ticket.stake_cents)} · Actual DK odds ${esc(ticket.odds>0?'+'+ticket.odds:ticket.odds??'—')}${settled?' · Official return '+money(ticket.settlement_return_cents)+' · Net '+(ticket.settlement_return_cents-ticket.stake_cents<0?'loss ':'profit ')+money(Math.abs(ticket.settlement_return_cents-ticket.stake_cents)):' · Potential total return '+money(ticket.potential_return_cents)}</p>
      <div class="tracked-legs">${(ticket.legs||[]).map(leg=>{
        if(settled)return `<div class="tracked-leg"><strong>${esc(leg.selection)}</strong><p>${esc(leg.event_name)}</p></div>`;
        const current=typeof leg.current==='number' && Number.isFinite(leg.current)?leg.current:null;
        const target=typeof leg.target==='number' && Number.isFinite(leg.target)?leg.target:null;
        return `<div class="tracked-leg"><strong>${esc(leg.selection)}</strong><p>${esc(leg.event_name)} · ${esc(leg.clock || 'Time unavailable')}</p><p>${esc(leg.score || 'Score unavailable')}</p>${target!==null?`<p>${current===null?'Stat unavailable':esc(current)} / ${esc(target)} ${esc(leg.unit || '')} · ${esc(leg.side || '')}</p>${current!==null&&target>0?`<progress max="${target}" value="${Math.max(0,Math.min(target,current))}" aria-label="Recorded stat relative to line"></progress>`:''}`:''}<small>${esc(leg.note || 'Awaiting game update')}</small></div>`;
      }).join('')}</div></article>`;
  }).join('');
}
