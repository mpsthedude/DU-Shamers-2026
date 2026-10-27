// Local rules only: generating or viewing an edition never calls a model/provider.
export function draftEdition(facts: any[], week: number, previousFacts: any[] = []) {
  if(!Array.isArray(facts) || facts.length!==12 || new Set(facts.map(f=>f.team_id)).size!==12)
    throw new Error("invalid_edition_facts");
  return facts.map((f,i)=>{
    if(typeof f.team_id!=="string" || !Number.isFinite(f.score) || !Number.isInteger(f.weekly_rank)) throw new Error("invalid_edition_facts");
    const ordinals=['','first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth'];
    const weeks=['','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen'];
    const previous=previousFacts.find(p=>p.team_id===f.team_id);
    const rank=`Week ${weeks[week] || 'unknown'} brought a ${ordinals[f.weekly_rank] || 'recorded'}-place scoring finish.`;
    const movement=previous && Number.isFinite(previous.score) && Number.isInteger(previous.weekly_rank)
      ? (f.weekly_rank<previous.weekly_rank
        ? `Up from ${ordinals[previous.weekly_rank]} last week. Management would like this filed under genius rather than damage control.`
        : f.weekly_rank>previous.weekly_rank
        ? `Down from ${ordinals[previous.weekly_rank]} last week. Apparently the victory parade took a wrong turn into the waiver wire.`
        : `The same scoring rank as last week. Consistency is a comforting word for refusing to move.`)
        + (f.score>previous.score ? ' Scoring improved, so at least the scoreboard has received the memo.' : f.score<previous.score ? ' The points total fell too; the motivational speech is now being delivered to an empty room.' : ' Even the points total stayed identical. The copy machine has requested a roster spot.')
      : 'The league now has a fresh exhibit for the group chat; management has declined to provide a rebuttal.';
    const verdicts=[
      'The trophy presentation is pending a mandatory inspection of the group-chat ego.',
      'Close enough to smell the trophy polish, far enough away to avoid buying any.',
      'A podium finish and an immediate request to be treated like a dynasty.',
      'Just outside the podium. The participation speech is already longer than the ceremony.',
      'The upper half of the table: premium seating for watching somebody else win.',
      'Top-half respectability, served with a complimentary ceiling on bragging rights.',
      'The lower half begins here. Please collect your visitor badge at reception.',
      'Not the basement, but the elevator is making ominous noises.',
      'The scoreboard has suggested a wellness check on the lineup decisions.',
      'Double-digit placement without the digits: an editorial courtesy the roster did not earn.',
      'Only one team supplied a softer landing. A thank-you note seems appropriate.',
      'Last in weekly scoring. Even the imaginary press conference has been cancelled.',
    ];
    const dispatches=[
      'The press office has requested that all follow-up questions be submitted never.',
      'The group chat has retained screenshots for the inevitable revisionist history.',
      'Management is calling this a learning experience, which is cheaper than hiring a coach.',
      'The official explanation is available as a very long voice memo nobody requested.',
      'A documentary crew has been asked to stop filming until morale improves.',
      'The roster meeting will include snacks, excuses, and absolutely no accountability.',
      'The scouting department is currently a browser tab and a strong feeling.',
      'The league has declined to recognize confidence as an additional scoring category.',
      'Public relations has asked the scoreboard to stop being so literal.',
      'The postgame handshake has been replaced with a muted notification.',
      'The emergency strategy meeting somehow became another podcast recommendation.',
      'A commemorative banner has been ordered in a deliberately unreadable font.',
      'The front office has promoted hindsight to head of football operations.',
      'The apology tour has been delayed by scheduling conflicts with the excuse tour.',
      'The analytics department has discovered that yelling at the app adds no points.',
      'The season documentary has been reclassified as a workplace comedy.',
      'The group chat jury requests that management stop representing itself.',
      'A strongly worded email to fantasy football remains unsent in drafts.',
    ];
    const dispatch=dispatches[(week-1+Number(f.team_id || i))%dispatches.length];
    if(f.team_id==='3') {
      const royalMovement=previous ? (f.weekly_rank<previous.weekly_rank ? 'The weekly scoring rank improved: another carefully timed demonstration of leadership.' : f.weekly_rank>previous.weekly_rank ? 'The lower weekly scoring rank is officially a generous morale grant to the opposition.' : 'An unchanged scoring rank confirms the administration remains firmly in control.') : 'The administration is setting its own pace.';
      return {team_id:f.team_id,prose:`${rank} ${f.weekly_rank<=4 ? 'Supreme Leader demonstrates visionary roster management.' : 'Supreme Leader has approved another strategic distribution of hope; the long-term vision remains flawless.'} ${royalMovement} The royal press office thanks the opposition for participating in week ${weeks[week]}; all requests to question the plan have been graciously deferred.`};
    }
    return {team_id:f.team_id,prose:`${rank} ${verdicts[f.weekly_rank-1]} ${movement} ${dispatch}`};
  });
}
