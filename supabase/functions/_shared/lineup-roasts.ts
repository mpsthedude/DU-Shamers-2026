// Historical matchup rosters only; never use today's roster to explain last week.
export function lineupInsights(payload: any, week: number, facts: any[]) {
  if(payload?.period!==week || !Array.isArray(payload.matchups)) throw new Error('lineup_period_mismatch');
  const result: any[]=[];
  const round=(n:number)=>Math.round(n*100)/100;
  for(const matchup of payload.matchups) for(const [side,opponent] of [[matchup.home,matchup.away],[matchup.away,matchup.home]]) {
    const fact=facts.find(f=>f.team_id===String(side?.teamId));
    const other=facts.find(f=>f.team_id===String(opponent?.teamId));
    if(!fact || !other || !['HOME','AWAY','TIE'].includes(matchup.winner)) throw new Error('lineup_matchup_unverified');
    const roster=side.rosterForCurrentScoringPeriod || side.rosterForMatchupPeriod;
    if(!Array.isArray(roster?.entries)) throw new Error('historical_roster_unavailable');
    const players=roster.entries.map((e:any)=>({name:e.playerPoolEntry?.player?.fullName,
      score:e.playerPoolEntry?.appliedStatTotal,slot:e.lineupSlotId,
      eligible:e.playerPoolEntry?.player?.eligibleSlots || []}));
    if(players.some((p:any)=>typeof p.name!=='string' || !Number.isFinite(p.score) || !Number.isInteger(p.slot))) throw new Error('lineup_player_unverified');
    const starters=players.filter((p:any)=>p.slot!==20 && p.slot!==21).sort((a:any,b:any)=>b.score-a.score);
    if(starters.length<1 || Math.abs(round(starters.reduce((n:number,p:any)=>n+p.score,0))-fact.score)>0.02) throw new Error('lineup_total_mismatch');
    const swaps=players.filter((p:any)=>p.slot===20).flatMap((bench:any)=>starters
      .filter((starter:any)=>bench.eligible.includes(starter.slot) && bench.score>starter.score)
      .map((starter:any)=>({bench,starter,gain:round(bench.score-starter.score)}))).sort((a:any,b:any)=>b.gain-a.gain);
    result.push({team_id:fact.team_id,opponent:other.team_name,margin:round(fact.score-other.score),
      stars:starters.slice(0,2),low:starters[starters.length-1],swap:swaps[0] || null});
  }
  if(result.length!==12 || new Set(result.map(t=>t.team_id)).size!==12) throw new Error('incomplete_lineup_insights');
  return result;
}

export async function fetchLineupInsights(week:number,facts:any[],s2:string,swid:string) {
  if(!s2 || !swid) throw new Error('espn_credentials_not_configured');
  const url=`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/290466?scoringPeriodId=${week}&view=mMatchup&view=mMatchupScore&view=mTeam`;
  const response=await fetch(url,{headers:{Cookie:`espn_s2=${s2}; SWID=${swid}`},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error('lineup_fetch_failed');
  const data=await response.json();
  if(data.id!==290466 || data.seasonId!==2026) throw new Error('unexpected_lineup_league');
  return lineupInsights({period:data.scoringPeriodId,matchups:data.schedule?.filter((m:any)=>m.matchupPeriodId===week)},week,facts);
}

// Edition prose deliberately spells numbers; official numeric facts stay separate.
function words(value:number):string {
  const n=Math.round(Math.abs(value)*100)/100;
  const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  const whole=(v:number):string=>v<20?small[v]:v<100?tens[Math.floor(v/10)]+(v%10?'-'+small[v%10]:''):small[Math.floor(v/100)]+' hundred'+(v%100?' '+whole(v%100):'');
  const [integer,decimal]=String(n).split('.');
  return (value<0?'minus ':'')+whole(Number(integer))+(decimal?' point '+decimal.split('').map(d=>small[Number(d)]).join(' '):'');
}
const name=(s:string)=>s.replace(/\d+/g,n=>words(Number(n)));
export function playerRoast(insight:any,royal=false) {
  if(!insight) return '';
  const [star,second]=insight.stars;
  const outcome=insight.margin>0?`Beat ${name(insight.opponent)} by ${words(insight.margin)} points.`:insight.margin<0?`Lost to ${name(insight.opponent)} by ${words(-insight.margin)} points.`:`Tied ${name(insight.opponent)}.`;
  const heroes=`${name(star.name)} led the starters with ${words(star.score)} points${second?`, backed by ${name(second.name)} with ${words(second.score)}`:''}.`;
  if(royal) return `${outcome} ${heroes} The royal scouting department will accept its flowers now. ${name(insight.low.name)} contributed ${words(insight.low.score)}; the administration describes this as a masterclass in delegating to the stars. The scoreboard is accurate, and the leadership remains beyond reproach.`;
  const low=`${name(insight.low.name)} supplied ${words(insight.low.score)} points. ${insight.low.score<=0?'A remarkably quiet contribution to a very loud group chat.':'The rest of the roster would appreciate a little more help with the group project.'}`;
  const swap=insight.swap;
  const bench=swap?`${name(swap.bench.name)} scored ${words(swap.bench.score)} on the bench, while the eligible alternative ${name(swap.starter.name)} started with ${words(swap.starter.score)}. That is ${words(swap.gain)} points of hindsight sitting in a folding chair.${insight.margin<0 && swap.gain>-insight.margin?' That single legal lineup swap would have reversed the fantasy result; hindsight has appointed itself head coach.':''}`:'There was no higher-scoring eligible bench replacement for a starter. The lineup optimizer has been excused from this particular investigation.';
  return `${outcome} ${heroes} ${low} ${bench}`;
}
