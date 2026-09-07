// Exact event + market + bookmaker + selection matching prevents season/market substitution.
export function matchFutures(events:any, mapping:any, now=Date.now()) {
 if(!Array.isArray(events)) return null;
 const event=events.find((e:any)=>e.id===mapping.event_id && e.sport_key===mapping.sport_key);
 const book=event?.bookmakers?.find((b:any)=>b.key==='draftkings');
 const market=book?.markets?.find((m:any)=>m.key==='outrights');
 const outcome=market?.outcomes?.find((o:any)=>o.name===mapping.outcome_name);
 const odds=outcome?.price, stamp=market?.last_update || book?.last_update, time=Date.parse(stamp);
 if(!Number.isInteger(odds) || Math.abs(odds)<100 || Math.abs(odds)>1000000 || !Number.isFinite(time) || time>now+300000 || time<now-86400000) return null;
 return {bet_id:mapping.bet_id,american_odds:odds,observed_at:new Date(time).toISOString()};
}
