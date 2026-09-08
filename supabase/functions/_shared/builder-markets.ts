const GAME_ODD_IDS=["points-home-game-ml-home","points-away-game-ml-away","points-home-game-sp-home","points-away-game-sp-away","points-all-game-ou-over","points-all-game-ou-under"];
function bookOffer(odd:any){
  const offer=odd?.byBookmaker?.draftkings;
  if(!offer || offer.available!==true)return null;
  return {odd_id:odd?.oddID??null,market:odd?.betTypeID??null,side:odd?.sideID??null,odds:offer.odds??null,
    spread:offer.spread??null,over_under:offer.overUnder??null,open_odds:offer.openOdds??null,
    open_spread:offer.openSpread??null,open_over_under:offer.openOverUnder??null,fair_odds:odd?.fairOdds??null};
}
function team(value:any){return {team_id:value?.teamID??null,name:value?.names?.long??value?.names?.medium??value?.name??"Unknown team",short:value?.names?.short??null};}

export async function collectBuilderMarkets(league:string, apiKey:string, paidFetch:any) {
  // Stable daily bounds share cache keys. Extra day covers the rolling seven-day UI.
  const start=new Date();start.setUTCHours(0,0,0,0);
  const end=new Date(start.getTime()+8*86400000);
  const params=new URLSearchParams({leagueID:league,type:"match",oddsAvailable:"true",bookmakerID:"draftkings",
    oddID:GAME_ODD_IDS.join(","),includeAltLines:"false",includeOpenCloseOdds:"true",started:"false",
    cancelled:"false",startsAfter:start.toISOString(),startsBefore:end.toISOString(),limit:"40"});
  const events=new Map<string,any>(),seen=new Set<string>();
  let pages=0,complete=false,reason:string|null=null;
  // Eight separately budgeted pages maximum. Only commissioners can fill cache misses.
  while(pages<8){
    let payload:any;
    try{
      const response=await paidFetch("https://api.sportsgameodds.com/v2/events?"+params,{headers:{"x-api-key":apiKey,"Accept":"application/json"}});
      if(!response.ok)throw new Error("provider_request_unavailable");
      payload=await response.json();
      if(payload?.success===false || !Array.isArray(payload?.data))throw new Error("provider_request_unavailable");
    }catch(error){
      if(!pages)throw error;
      reason="remaining_pages_unavailable";break;
    }
    pages++;
    for(const event of payload.data){
      const odds=Object.values(event?.odds||{}).map(bookOffer).filter(Boolean);
      const starts=Date.parse(event?.status?.startsAt);
      if(!event?.eventID || !odds.length || !Number.isFinite(starts) || starts<Date.now() || starts>=end.getTime() || event?.status?.cancelled)continue;
      events.set(event.eventID,{event_id:event.eventID,league:event.leagueID,starts_at:event.status.startsAt,
        home:team(event?.teams?.home),away:team(event?.teams?.away),odds});
    }
    const cursor=payload.nextCursor;
    if(!cursor){complete=true;break;}
    if(typeof cursor!=="string" || cursor.length>2000 || seen.has(cursor)){reason="pagination_stopped";break;}
    seen.add(cursor);params.set("cursor",cursor);
  }
  if(!complete && !reason)reason="page_limit_reached";
  return {bookmaker:"draftkings",leagues:[league],events:[...events.values()].sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at)),
    coverage:{complete,pages,reason,starts_at:start.toISOString(),ends_at:end.toISOString()},generated_at:new Date().toISOString()};

}
