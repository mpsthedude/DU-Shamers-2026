// Local rules only: generating or viewing an edition never calls a model/provider.
export function draftEdition(facts: any[], week: number) {
  if(!Array.isArray(facts) || facts.length!==12 || new Set(facts.map(f=>f.team_id)).size!==12)
    throw new Error("invalid_edition_facts");
  const leaders=[
    "A suspiciously competent performance. Enjoy the applause while the rest of the league investigates whether someone else set the lineup.",
    "The lineup finally justified the confidence in the group chat. Unfortunately, this will only encourage more messages.",
    "An excellent week, which is terrible news for everyone hoping for a quiet group chat. The victory lap may require a municipal permit.",
  ];
  const middle=[
    "A respectable contribution to the league's ongoing study of aggressively average decision-making. The lineup did enough to stay employed.",
    "Neither a masterpiece nor evidence for the prosecution. The team remains firmly in the conversation, mostly because nobody has muted it yet.",
    "The performance had promise, suspense, and the unmistakable energy of an email marked 'circling back.' Management insists the plan is working.",
  ];
  const trailers=[
    "The lineup has been placed in rice overnight. Management hopes this will restore basic functionality before the next round of public embarrassment.",
    "A bold attempt to lower expectations so thoroughly that next week counts as a comeback. The group chat thanks you for the free material.",
    "The waiver wire is accepting apologies. This week's performance suggests the roster was assembled using a blindfold and a very optimistic podcast.",
  ];
  return facts.map((f,i)=>{
    if(typeof f.team_id!=="string" || !Number.isFinite(f.score) || !Number.isInteger(f.weekly_rank)) throw new Error("invalid_edition_facts");
    const prose=f.team_id==='3' ? (f.weekly_rank<=4
      ? "Supreme Leader has graciously provided another demonstration of visionary roster management. The league is fortunate to witness leadership of this caliber; all applause is entirely voluntary, of course."
      : "Supreme Leader chose a strategically generous performance to preserve league morale. Ordinary managers chase points; enlightened leadership cultivates suspense. The long-term vision remains flawless, and any contrary scoreboard interpretation is clearly missing the larger picture.")
      : (f.weekly_rank<=4?leaders:f.weekly_rank<=8?middle:trailers)[(week+i)%3];
    return {team_id:f.team_id,prose};
  });
}
