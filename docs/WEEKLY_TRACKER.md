# Shared weekly ticket tracker

The Engagement Hub reads placed weekly tickets and saved event snapshots from league-dashboard. Placed and settled ticket history comes from the existing bet records. The tracker appears at the top once tickets exist; score/stat progress never settles a ticket or changes the bank.

The refresh-weekly-tracker worker is deployed with its policy paused. A pg_cron job checks once per minute, making no HTTP call while paused. A database lease limits enabled work to one shared attempt every 180 seconds. Only open weekly tickets with NFL/college games starting within ten minutes or started within the past eighteen hours are eligible. Terminal games and settled tickets stop refreshing. Up to 40 distinct events are requested in one batch. All calls use the normal provider dollar/request/object gates, charged to a currently allowlisted commissioner. Public scheduler triggers cannot supply event IDs or override limits.

Saved snapshots contain only numeric score/stat progress for ticket selections, phase, and observation time. Missing values stay unavailable. Clock data is not mapped yet and displays unavailable. Postponed games beyond the original eighteen-hour window require review; this prevents indefinite polling. Browsers read the shared dashboard every three minutes while visible. Failures retain prior snapshots and show stale data.

SportsGameOdds documents results at results.<periodID>.<statEntityID>.<statID>: https://sportsgameodds.com/docs/data-types/stats. Live NFL/college stat completeness still requires a bounded real-game verification after limits are configured.

Validation: 58 Node checks passed, including score/prop mapping, missing values, terminal phases, and a paused worker making no provider calls. Rolled-back database checks verified object reservations, failed-call accounting, idle/duplicate/finished refresh denial, and unchanged official settlement. Live smoke checks confirmed paused worker and valid empty tracker response. No live wager or event refresh was created.


## October 1 update
The shared tracker is enabled. A database lease now spaces provider refreshes at least 600 seconds apart; the minute scheduler makes this approximately every 10–11 minutes while eligible games are active. Browsers read the shared dashboard cache each minute while visible, without extra sports-provider calls. A 12-minute freshness threshold accommodates scheduling latency. Existing request/object/spending limits and terminal-game exclusions remain enforced. Missing provider stats stay unavailable; only commissioner-confirmed settlement changes money. Historical ticket results and ledger transactions are nested under the League Bank details; active tickets lead the homepage.


## Retired October 1, 2026 (Central)
Live scores and player-stat updates are removed. The scheduler is removed, policy disabled, and worker returns HTTP 410 without calling providers. The homepage shows only placed ticket terms and scheduled kickoff. Bank history and commissioner settlement remain available. This supersedes the refresh cadence described above.
