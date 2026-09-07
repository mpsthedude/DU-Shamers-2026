// Provider results are progress only, never settlement evidence.
export function eventProgress(event:any, legs:any[]) {
 const number=(v:any)=>typeof v==='number' && Number.isFinite(v)?v:null;
 const home=number(event?.results?.game?.home?.points),away=number(event?.results?.game?.away?.points);
 const values:Record<string,number|null>={};
 for(const leg of legs){
  const parts=String(leg.odd_id).split('-');
  if(parts.length!==5 || parts[2]!=='game')continue;
  const [stat,entity]=parts;
  let value=number(event?.results?.game?.[entity]?.[stat]);
  if(entity==='all' && stat==='points' && value===null && home!==null && away!==null)value=home+away;
  values[leg.odd_id]=value;
 }
 return {phase:event?.status?.cancelled===true?'cancelled':event?.status?.ended===true?'finished':event?.status?.started===true?'live':'upcoming',
  score:home!==null && away!==null?`Away ${away} · Home ${home}`:null,clock:null,values};
}
export function ticketProgress(rows:any[],now=Date.now()){
 const times:string[]=[];
 const tickets=(rows||[]).map(ticket=>{
  const legs=(ticket.legs||[]).map((leg:any)=>{
   const s=leg.snapshot,parts=String(leg.odd_id).split('-');
   if(leg.observed_at)times.push(leg.observed_at);
   const stale=!leg.observed_at || now-Date.parse(leg.observed_at)>180000;
   return {selection:leg.selection,event_name:leg.event_name,score:s?.score??null,clock:s?.clock??null,
    current:s?.values?.[leg.odd_id]??null,target:leg.target==null?null:Number(leg.target),unit:parts[0]?.replaceAll('_',' '),side:parts[4]||'',
    phase:s?.phase||'upcoming',observed_at:leg.observed_at??null,
    note:s?.phase==='cancelled'?'Game cancelled · awaiting commissioner review':s?.phase==='finished'?'Game finished · awaiting commissioner settlement':!s?'Game update unavailable':stale?'Updates delayed':'Latest provider snapshot'};
  });
  const phase=legs.length && legs.every((g:any)=>['finished','cancelled'].includes(g.phase))?'finished':legs.some((g:any)=>g.phase==='live')?'live':'upcoming';
  return {...ticket,legs,phase};
 });
 return {tickets,observed_at:times.sort()[0]||null,delayed:tickets.some(t=>t.status==='OPEN' && t.legs.some((g:any)=>!g.observed_at || now-Date.parse(g.observed_at)>180000))};
}
