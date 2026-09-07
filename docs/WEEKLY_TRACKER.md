# Shared weekly ticket tracker

The Engagement Hub reads placed weekly tickets and saved event snapshots from league-dashboard. Placed and settled ticket history comes from the existing bet records. The tracker appears at the top once tickets exist; score/stat progress never settles a ticket or changes the bank.

The refresh-weekly-tracker worker is deployed with its policy paused. A pg_cron job checks once per minute, making no HTTP call while paused. A database lease limits enabled work to one shared attempt every 180 seconds. Only open weekly tickets with NFL/college games starting within ten minutes or started within the past eighteen hours are eligible. Terminal games and settled tickets stop refreshing. Up to 40 distinct events are requested in one batch. All calls use the normal provider dollar/request/object gates, charged to a currently allowlisted commissioner. Public scheduler triggers cannot supply event IDs or override limits.

Saved snapshots contain only numeric score/stat progress for ticket selections, phase, and observation time. Missing values stay unavailable. Clock data is not mapped yet and displays unavailable. Postponed games beyond the original eighteen-hour window require review; this prevents indefinite polling. Browsers read the shared dashboard every three minutes while visible. Failures retain prior snapshots and show stale data.

SportsGameOdds documents results at results.<periodID>.<statEntityID>.<statID>: https://sportsgameodds.com/docs/data-types/stats. Live NFL/college stat completeness still requires a bounded real-game verification after limits are configured.

Validation: 58 Node checks passed, including score/prop mapping, missing values, terminal phases, and a paused worker making no provider calls. Rolled-back database checks verified object reservations, failed-call accounting, idle/duplicate/finished refresh denial, and unchanged official settlement. Live smoke checks confirmed paused worker and valid empty tracker response. No live wager or event refresh was created.
