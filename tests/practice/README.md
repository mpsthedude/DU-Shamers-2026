# Local weekly wager rehearsal

Visibility simulation: use View as to switch weekly winner/another owner/guest/commissioner. Only the winner sees Weekly Control before submission. Load placed sample ticket seeds a fictional $50 wager at +200 and exposes the top tracker to all viewers; it replaces any current practice ticket. Tracker test changes game progress without settlement. Reset practice restores the initial winner view with no placed ticket. Browser checks passed for all viewer states, sample placement, guest tracking, final-without-settlement and reset. No real users or records are changed.

NFL player props are now simulated: use PLAYER PROPS on an NFL game to browse fictional passing, rushing, receiving-yard and reception markets. The yellow banner's Prop test selector simulates no props or a provider outage. Same-game selections are allowed with an explicit unadjusted-estimate warning and no displayed combined implied probability. The commissioner must verify DraftKings accepts the exact combination and record actual combined odds. No live provider or email request is made.

Props browser validation passed: player search, categories, add/remove, cache reopening, empty/outage ticket preservation, mixed-game submission, commissioner player/market/line details and mobile width. The later same-game browser test verified a game+prop ticket, warning, submission, actual +200 placement override and $150 winning return for a $50 stake rather than the displayed estimate. All 49 automated checks passed. Server tests verify prop price/line changes, unavailable offers, missing player identity and started-game rejection. This does not verify live account access or actual sportsbook combination acceptance. These edits remain local pending deployment and a budget-controlled real-data check.

Run `node scripts/practice-server.cjs` from the repository, then open http://127.0.0.1:4174/.
The server binds only to loopback. Close it with Ctrl+C when run in a terminal.

The page runs the actual dashboard, member submission controls and commissioner controls with an in-memory API fixture. It replaces the Supabase SDK, intercepts every fetch without a network fallback, and adds a same-origin Content Security Policy. No credentials, email, paid providers or production writes are involved. Only allowlisted public assets are served. The production build does not include these fixtures.

1. Choose $50 cash + $50 wager or $100 Let It Ride.
2. Search a team, filter NFL/College and select a home moneyline (+150), then submit to commissioner.
3. Use the yellow banner to switch to commissioner. Enter +150 as actual odds and record a simulated placement. The normal confirmation dialog refers to DraftKings; in this page it only updates the fixture.
4. Choose Won, Lost or Push/Void. Inspect the Bonus Bank and practice summary.
5. Reset practice to try the other choice or outcome. Reload also resets all simulated financial records.

Expected results at +150:

| Choice | Cash | Stake | Weekly remaining after placement | Win return | Loss return | Refund |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Split | $50 | $50 | $1,300 | $125 | $0 | $50 |
| Ride | $0 | $100 | $1,300 | $250 | $0 | $100 |

Returns include the stake. The Bonus Bank starts at zero. The browser includes 16 fabricated NFL and 8 college matchups with moneylines, spreads and totals. One NFL matchup is nine days away to exercise the date filter. All matchups, dates and odds are fabricated and do not represent available DraftKings bets. Standings, account changes, invitations and paid analysis are outside this fixture.

Game browser validation: search, NFL/college filters, seven-day/all-loaded date filters, scroll area, empty results, retaining selected legs across filters, and desktop/mobile width passed without external requests. The expanded fixture adds 48 explicitly fictional college matchups (56 total), shows 20 at a time, and supports searching all 56 immediately. Show more was checked at 40 and 56 cards; searching Practice College 96 finds a game outside the initial visible set.

The local backend implementation now follows opaque provider cursors within a stable eight-day date window, capped at eight 40-event pages per league. Every page passes through the existing shared cache, commissioner authorization and budget reservation. Later page failures retain earlier results and mark coverage incomplete; repeated cursors stop rather than loop. No new budget is enabled. The browser displays coverage status and searches only loaded games. Conference filters are deferred until reliable source metadata is verified. Backend changes require deployment before production gets this behavior.

The 48 automated tests include pagination, deduplication, budget interruption, page limits, repeated cursors and unavailable/started-event filtering. No live provider call was made for validation. API pagination/date parameters were verified against https://sportsgameodds.com/docs/endpoints/getEvents and https://sportsgameodds.com/docs/guides/data-batches.

Validation on September 7, 2026: six browser flows passed, no page errors or external requests, and no horizontal overflow at 390px. All 44 frontend/API tests passed. Separate `weekly-submissions.sql` and `commissioner-accounting.sql` checks exercised deployed RPCs inside rolled-back transactions. Afterwards the database retained zero users/proposals/bets and its original four ledger entries; the submission clock was restored. The fixture itself is not an authentication or live sportsbook integration test.
