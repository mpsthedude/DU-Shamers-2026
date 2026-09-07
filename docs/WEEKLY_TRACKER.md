# Weekly tracker prototype

The practice page has a display-only tracker with sample score, clock, player stat/line, actual placed odds, stake, potential total return, observation time and commissioner-confirmed status. Use Tracker test in the yellow banner to simulate upcoming/live/delayed/finished states. Finished progress does not settle bets. No provider requests, automatic timers or financial writes are introduced by the tracker.

SportsGameOdds documents live scores and player results at https://sportsgameodds.com/use-cases/live-scores-sports-data-api and results.<periodID>.<statEntityID>.<statID> at https://sportsgameodds.com/docs/data-types/stats. Account-specific access, NFL/college completeness, clock fields and latency have not been verified with a paid call. Missing statistics must remain unavailable, not inferred as zero or nonparticipation.

Remaining backend work: obtain active placed weekly ticket legs; match provider event/entity/stat identifiers; refresh a shared snapshot only for active ticket games through the existing paid gate; enforce a global cadence/budget and stop updates after completion; expose only curated public snapshots; persist settled ticket history. Owners must not individually trigger paid refreshes. Score/stat progress never invokes settlement RPCs. Official results and returns come from commissioner confirmation, including voided-leg adjustments.

Validated locally: live 187/249.5 sample, delayed observation notice, upcoming missing stats, final awaiting settlement, unchanged bank, mobile width, escaping and official zero return. The website release includes this renderer, but it stays hidden without placed-ticket snapshots. Live backend tracking remains unfinished.
