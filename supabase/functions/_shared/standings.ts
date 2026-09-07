export function normalizeStandings(payload: any) {
  if (payload?.id !== 290466 || payload?.seasonId !== 2026 || !Array.isArray(payload.teams)
    || payload.teams.length !== 12 || !Number.isInteger(payload.scoringPeriodId) || payload.scoringPeriodId<1)
    throw new Error("unexpected_espn_league");
  const number = (v: any) => typeof v === "number" && Number.isFinite(v) ? v : null;
  const teams = payload.teams.map((t: any) => {
    if (!Number.isInteger(t.id) || typeof t.name !== "string" || !t.name.trim() || t.name.length>200) throw new Error("invalid_espn_team");
    const r=t.record?.overall;
    return {team_id:String(t.id),team_name:t.name.trim(),wins:number(r?.wins),losses:number(r?.losses),ties:number(r?.ties),
      points_for:number(r?.pointsFor),points_against:number(r?.pointsAgainst),
      all_play_wins:0,all_play_ties:0,all_play_comparisons:0,all_play_percentage:null as number|null,power_rank:null as number|null};
  }).sort((a:any,b:any)=>Number(a.team_id)-Number(b.team_id));
  if(new Set(teams.map((t:any)=>t.team_id)).size!==12) throw new Error("duplicate_espn_team");
  const periods=payload.settings?.scheduleSettings?.matchupPeriods;
  if(!periods || !Array.isArray(payload.schedule)) throw new Error("missing_espn_schedule");
  const candidates=[...new Set(Object.values(periods).flat())].filter((w:any)=>Number.isInteger(w) && w>=1 && w<payload.scoringPeriodId) as number[];
  const completed: any[]=[]; const omitted: number[]=[];
  for(const week of candidates.sort((a,b)=>a-b)){
    const scores=new Map<string,number>(); let valid=true;
    for(const matchup of payload.schedule){
      const weeks=periods[String(matchup.matchupPeriodId)];
      if(!Array.isArray(weeks) || !weeks.includes(week)) continue;
      // Never treat an undecided matchup or a multi-week total as a completed weekly score.
      if(!["HOME","AWAY","TIE"].includes(matchup.winner)) {valid=false;continue;}
      for(const side of [matchup.home,matchup.away]){
        if(!side || !Number.isInteger(side.teamId)) continue;
        const id=String(side.teamId);
        if(!teams.some((t:any)=>t.team_id===id)) continue;
        const value=number(side.pointsByScoringPeriod?.[String(week)]) ?? (weeks.length===1?number(side.totalPoints):null);
        if(value===null) {valid=false;continue;}
        const score=Math.round(value*100)/100;
        if(scores.has(id) && scores.get(id)!==score) valid=false;
        scores.set(id,score);
      }
    }
    if(!valid || scores.size!==teams.length) {omitted.push(week);continue;}
    completed.push({week,scores:teams.map((t:any)=>({team_id:t.team_id,score:scores.get(t.team_id)}))});
    for(const team of teams){
      const score=scores.get(team.team_id)!;
      for(const [id,other] of scores){
        if(id===team.team_id)continue;
        team.all_play_comparisons++;
        if(score>other)team.all_play_wins++;
        else if(score===other)team.all_play_ties++;
      }
    }
  }
  for(const team of teams) if(team.all_play_comparisons) team.all_play_percentage=(team.all_play_wins+0.5*team.all_play_ties)/team.all_play_comparisons;
  if(completed.length) {
    const ordered=[...teams].sort((a,b)=>b.all_play_percentage!-a.all_play_percentage! || Number(a.team_id)-Number(b.team_id));
    ordered.forEach((t,i)=>{t.power_rank=i>0 && t.all_play_percentage===ordered[i-1].all_play_percentage?ordered[i-1].power_rank:i+1;});
  }
  return {source:"ESPN",espn_league_id:290466,year:2026,scoring_period:payload.scoringPeriodId,
    completed_weeks:completed,omitted_weeks:omitted,teams,
    methodology:"All-play: (wins against every other team + half of ties) / comparisons, using complete scoring weeks only. Equal percentages share a rank. Weekly scores are rounded to two decimals.",
    results_status:completed.length?"completed_weeks_only":"awaiting_completed_week"};
}
export async function fetchStandings(s2: string, swid: string) {
  if(!s2 || !swid)throw new Error("espn_credentials_not_configured");
  const url="https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/290466?view=mTeam&view=mSettings&view=mMatchupScore";
  const response=await fetch(url,{headers:{Accept:"application/json",Cookie:"espn_s2="+s2+"; SWID="+swid},
    signal:AbortSignal.timeout(15000),redirect:"error"});
  if(!response.ok)throw new Error("espn_refresh_failed");
  return normalizeStandings(await response.json());
}
