# DU Shamers 2026: verified project handoff

### ESPN-inspired visual refresh

- User paused authentication work and requested ESPN Fantasy colors/theme. Inspected public https://fantasy.espn.com/football/welcome and /football/leaders, their computed styles and ESPN's public espn-ui.css. Reference uses #edeef0 canvas, white cards, #151617 text, #dcdddf lines, a charcoal masthead and blue controls. DU Shamers uses its own red DU mark and system fonts; no ESPN logos/fonts or marketing artwork were copied.
- league-theme.css loads after the existing component CSS and applies the complete light theme, compact cards/tables, accessible dark-header controls, restrained shadows, and responsive sizing. Blue controls are slightly darker than the public reference for text contrast. Semantic positive/negative money retains green/red. Existing auth/props/analysis surfaces receive styling only; no authentication logic or backend changes.
- Added league section navigation and clubhouse heading, real Futures/Bank ledger anchor targets, and full-width ledger when the commissioner panel is hidden. Content-versioned build includes the new stylesheet. Header action contrast was visually checked and corrected.
- Playwright/Edge headless preview verified at 1440px and 390px: all 12 live standings rows, no page-width overflow, no JavaScript errors and all six navigation targets present. Desktop/full-mobile screenshots inspected; phone top-of-page controls remain legible. Build passed. Screenshots/reference scratch files remain in ignored .local/. No paid calls, auth changes or financial writes.

### Saved weekly editions increment

- Migration 20260907145509_weekly_editions, commissioner-api v7 and league-dashboard v6 are deployed. weekly_editions stores immutable source facts/snapshot, revision, edit version, generator version, private draft text and published history. Service-only invoker RPCs derive facts from complete ESPN weeks and serialize edits/publication on the season row. No browser table/RPC grants or public draft access.
- Commissioner editorial desk creates/reopens a draft for a completed week, previews all 12 reports, saves private edits and explicitly publishes. Repeated create preserves existing edits. Stale edit versions fail; a corrected source blocks publication. Replacement publication archives the previous edition atomically. Public readers see only current published editions for each week; archived revisions remain in the DB for provenance. Source corrections/unavailability get a visible historical-edition notice.
- _shared/editions.ts generates rule-based prose with no model/provider/network calls. Supreme Leader is stable ESPN team ID 3, with fixed favorable satire even at the bottom of the scoring table; other team prose is editable. Scores and weekly scoring ranks (including tied ranks) are derived separately from ESPN. Jokes cannot contain digits at publication; narrative semantics remain commissioner-reviewed, not automatically fact-checked. This is not an AI integration and does not use the OpenAI key or spending allowance.
- editions.js renders published text safely and supplies commissioner draft markup with escaped textareas. Homepage teaser expands to the complete narrative and week archive. Before the first completed week, it shows an honest pending state. No fixture recap has been published and no messaging integration exists.
- 38 Node tests pass, including generation, unfavorable Supreme Leader facts with favorable prose, safe public/editor rendering, correction/outage states, and public API exclusion of drafts with no provider dispatch. Rolled-back SQL tests pass before/after deployment for team completeness, authorization, optimistic edits, editorial lock, publication retries/immutability, source corrections and replacement revisions. Actual authenticated browser create/edit/publish remains untested; no completed production scoring week exists yet.
- No editions, fixture users, paid requests or financial records were added by verification; the original four ledger rows remain. Advisors show 23 intentional RLS/no-policy INFO notices plus the two existing profile-trigger WARN notices. Deploy commissioner-api with both _shared/standings.ts and _shared/editions.ts.
- Next: commissioner tie/correction resolution controls, verify actual sign-in and the first in-window cloud ESPN sync, and replace remaining sample futures with the real portfolio workflow. Paid intelligence remains disabled pending calibrated budgets and a narrow adapter.

### Weekly winner synchronization increment

- Migration 20260907144128_atomic_winner_sync and sync-weekly-winner v5 are deployed. The scheduled endpoint uses the shared ESPN standings normalizer, requiring all 12 distinct team scores and a completed scoring week. No default-zero scores, cumulative multi-week scores, double-counted matchups, or arbitrary caller-supplied week. ESPN fetch has a 15-second timeout and no redirects/retries.
- Service-only invoker begin_weekly_sync / finish_weekly_sync share the season row lock used by submissions and placement. A two-minute lease and 15-minute cooldown bound calls under the public scheduler key, including failures. Both layers enforce Tuesday 09:00 America/New_York. The 2026 calendar checks Week 1 on September 15 through Week 14 on December 15; frozen ESPN periods fail instead of opening an old award window. Calendar source: https://www.nfl.com/schedules/2026/by-week/week-1 . Future seasons require an explicit calendar update.
- Award and sanitized leaderboard snapshot save atomically. Matching retries preserve identified_at. Pre-decision corrections can update a winner; ties require review. Changed results after a decision or cash entry preserve award identity, choices and financial records, save pending_correction evidence and block new placement/submission. A subsequent matching snapshot cannot silently clear this review flag. Existing placed-ticket retries and settlement remain available. No commissioner tie/correction resolution UI exists yet.
- The existing GitHub Tuesday schedule now refreshes the leaderboard as part of the winner sync through Week 14. Commissioner-only manual standings refresh remains available separately. Incomplete-score responses return HTTP 409 so the workflow fails visibly. No extra paid provider or model calls were enabled.
- 32 Node tests pass, including actual handler execution with stubbed provider/DB and summer/winter time gates. Rolled-back service_role SQL checks passed before/after deployment for retries, tie/corrections, locked choices, placement blocking, cooldown/leases, stale periods, Week 14 cutoff and a forced snapshot-write failure. Existing commissioner accounting and weekly submission SQL regressions also passed. No multi-session stress test or live in-window ESPN cloud fetch yet.
- Live off-window endpoint safely skips; dashboard still returns 12 teams and the pending Week 1 award. Zero bets, decisions, sync leases, paid requests and fixture users remain; four original ledger rows are unchanged. Test clock overrides were rolled back. Advisors show 22 intentional RLS/no-policy INFO notices and the two pre-existing profile-trigger WARN notices.
- Next: saved weekly roast drafts/archive and a commissioner review/resolution workflow. Actual commissioner sign-in and cloud ESPN credentials remain unverified; local .env credentials work but have not been uploaded as part of this change.

Audit date: 2026-09-07. Baseline git commit: 1634d06984576b14ff893d70f87a646e6cb2e12e. Source is authoritative over prior narrative handoffs; distinguish inspected code, live observations and untested paths below.

## Repair update: 2026-09-07

### ESPN leaderboard and team earnings increment

- Migration 20260907135719_cached_league_standings stores sanitized, versioned ESPN snapshots and throttles commissioner refreshes to one attempt per 15 minutes. league-dashboard v5 reads the latest saved snapshot and live team accounting aggregates; it never calls ESPN on a public page view. commissioner-api v6 can refresh through _shared/standings.ts under Auth and the email allowlist. Include that shared module when deploying the commissioner function.
- Initial actual ESPN snapshot imported from locally authenticated ESPN league 290466/2026: 12 teams, scoring period 1, all records 0-0-0, no complete scoring week and no power ranks. Supreme Leader is verified ESPN team ID 3. Only normalized team names, records, points and completed weekly scores are stored; owner IDs, rosters and cookies are excluded. Local .env remains ignored and credentials were not copied to cloud secrets.
- All-play compares each team with every other team per complete week, with half credit for ties and shared competition ranks. Requires prior scoring period, terminal matchup winner, all 12 team scores and no conflicting duplicates. Uses pointsByScoringPeriod for multi-week matchups, never cumulative totals as weekly scores. Unfinished/incomplete weeks are omitted visibly. Source hash and immutable snapshot ID support later correction/roast versions.
- Front-page standings.js shows records, PF/PA, all-play, top-score weeks (ties included), cash allocation and settled shared-bank net. Expandable details separate gross returned stake, open stakes/potential returns and unattributed league positions. Financial joins use stable team IDs via decision/member and proposal/submitter links; failed earnings reads show unavailable rather than zero.
- Refresh is commissioner-initiated, not automatic yet; the page labels observation time and marks snapshots older than 24 hours. Hosted refresh depends on configured ESPN secrets; the actual authenticated browser refresh path is not tested. scripts/snapshot-espn.cjs can produce a sanitized local snapshot from .env into ignored .local/ for inspection/import.
- 28 Node checks and rolled-back service_role SQL checks pass: ranking ties/completeness/deduplication, multi-week scores, safe text/outage rendering, earnings across win/loss/push/void/open/futures without double-counting cash, season isolation and refresh leases/cooldown. Live dashboard returns 12 teams, null ranks, empty earnings and the observed snapshot timestamp. No paid provider calls or actual financial changes.
- Next: repair winner-sync writes and correction coordination before automated refresh, verify actual commissioner sign-in, then saved weekly roast drafts/archive. Paid provider gate remains off with zero allowances.

### Paid provider controls increment

- Migration 20260907133445_provider_spending_gate adds service-only budget, reservation and 60-second cache tables. Global policy is disabled with zero allowances. No spending amount was chosen or enabled during development.
- Shared _shared/paid.ts gates every active SGO request in markets v9, props v3, analyzer v2 and member-api v4. Commissioner-api v5 adds budget status/settings/pause under Auth plus the email allowlist. Futures v5 and integration-health v4 retire public probes with HTTP 410. Hosted intelligence URL dispatch is removed pending a budgeted adapter.
- A locked policy row serializes reservations before network dispatch. Daily/monthly request and reserved-cost caps, per-user daily quotas, two concurrent requests, same-key deduplication, 15-second network timeout and two-minute leases apply globally. No automatic retries or fallback providers. Failed/ambiguous reservations remain counted; expired leases become UNKNOWN without a refund.
- Fresh general odds/analysis calls require current commissioner authorization. Public visitors can read fresh cached snapshots. Approved weekly winners can validate under the same caps after eligibility preflight. Credentials stay server-side; canonical query keys and original observation times are shared across callers.
- Dollar limits use a commissioner-configured worst-case charge per request (including up to 40 returned events). These are estimated allowances, not independently verified provider charges. Actual charge/token reconciliation is not implemented; actual_microusd stays null. Verify plan-specific costs before enabling. Hosted model calls remain disabled.
- Commissioner UI includes counts, reserved amounts, limit inputs, explicit enable checkbox and pause/refresh buttons. Market failures clear sample lines. Props browser cache expires after 60 seconds and ignores late responses for a different active game. Missing analysis probabilities remain unavailable.
- 23 Node checks pass, including actual endpoint execution with a disabled gate and zero provider dispatch. Rolled-back service_role SQL checks cover disabled/auth failures, cache reuse, in-flight limits, monetary/request limits, user quotas and failed/expired reservation retention. No simultaneous-session stress test or real authenticated paid dispatch yet.
- Live verification: bank 200; member/commissioner 401 with public key; markets/props/analyzer 503 paid_requests_disabled; probes 410. Disabled policy, zero provider requests/cache rows/test users, four unchanged ledger rows. Advisors: 19 intentional RLS/no-policy INFO notices, two existing profile-trigger WARN notices.
- Deploy shared consumers with both <slug>/index.ts and _shared/paid.ts; do not upload only their entrypoint. Next: cached ESPN leaderboard/earnings, winner-sync write/correction coordination and saved roast drafts/archive. Actual sign-in, provider-plan calibration and historical schema export remain outstanding.
- Browser verification found cached unversioned scripts surviving deployment. scripts/build-site.cjs now copies only the public allowlist and inserts content hashes into local JS/CSS URLs in the published HTML, so returning visitors receive changed assets.

### Weekly submission increment

- Migration 20260907131836_atomic_weekly_submissions and member-api v3 are deployed. submit_weekly_ticket atomically saves the immutable weekly choice, cash ledger allocation, proposal and validated legs. Season/award row locks and unique indexes protect retries and one active proposal per decision. Rejected/expired proposals can be replaced with the same locked choice without another cash entry.
- Client supplies award ID and a stable retry UUID for the unchanged ticket. The server stores a canonical request for conflict detection. Matching saved retries return before fresh provider calls, including after the deadline; new requests check winner membership, latest award, Weeks 1-14, unresolved ties, award observation time and allocation before validating markets.
- The submission window is Tuesday 09:00 to Sunday 11:00 America/New_York in the award identification week. An older award does not gain a new deadline the next week. This relies on the trusted winner sync assigning the correct ESPN week; sync INSERT privileges and correction/decision coordination remain a separate repair. Auth sign-in/ESPN end-to-end behavior remains unverified.
- Rejects >12 legs (no silent truncation), duplicates, malformed odds and changed DraftKings prices/lines. Persisted event/sport/market/selection descriptions come from the provider. Stored line_value preserves the accepted spread/total. Game selections now carry their numeric line to submission. Unverified client combined estimates are not stored; actual combined DK odds are recorded at manual placement.
- Thirteen Node tests pass. Rolled-back service_role SQL tests passed before/after deployment for both choices, failed ledger/proposal/leg writes, replay conflicts, rejected replacements, cash uniqueness, placement stake, wrong winner, stale selections, allocation limits and DST-aware deadline boundaries. Tests temporarily substitute the RPC clock inside the rollback transaction only; production clock restoration was verified. No live paid provider calls, test identities, decisions, proposals or bets persisted; original ledger still has four rows.
- Cash entries represent the weekly cash allocation in the existing accounting model; no physical cash transfer occurs. Paid-call global budgets/cache/quotas are still unfinished, as are winner sync write repair, actual sign-in, leaderboard and saved roasts. Next priority is closing paid-call exposure before group rollout.

### Team claims increment

- Migration 20260907130332_atomic_team_claims adds service-only SECURITY INVOKER manage_team_claim. A transaction-level advisory lock per league serializes claim transitions; existing unique indexes remain the final constraint. ESPN directory validation happens before the transaction.
- Request retries reuse the same active claim. Approval and commissioner self-assignment save membership and claim status atomically. Approval/rejection/cancellation replays return the existing result; conflicting terminal states fail. Cancellation requires the specific claim ID so an old retry cannot cancel a newer request.
- member-api v2 and commissioner-api v4 are deployed. Self-assignment requires the current email allowlist result, rather than a previously stored commissioner role alone. SQL additionally checks commissioner membership; browser roles cannot execute the RPC or write claim tables.
- Nine Node regression tests pass, including actual TypeScript handler evaluation with stubbed identity/provider calls. tests/team-claims.sql passed before and after deployment using SET LOCAL ROLE service_role inside rolled-back transactions. Tests cover authorization, cross-league isolation, competing requests, terminal conflicts, retries and forced write failures. Simultaneous multi-session load and real magic-link sign-in remain untested.
- After checks: 0 claims, 0 memberships, 0 bets, 4 original ledger rows, 0 test Auth users. No paid provider requests or real team assignments were made during development.
- Weekly decision/proposal insertion and winner sync still require their own atomic workflow/grant repair. Do not describe weekly submissions as ready. Next: bind submissions to the actual award window, validate refreshed DraftKings lines, and atomically save decision/cash/proposal/legs before granting those writes. Spending controls, leaderboard and saved roasts follow.

### Commissioner accounting increment

- Migration 20260907124703_harden_commissioner_accounting adds SECURITY INVOKER RPCs record_ticket_placement and record_ticket_settlement, executable only by service_role. The Edge Function validates the Auth user and current commissioner email allowlist before passing actor ID; RPCs also check commissioner membership in the target season's league.
- Placement locks the season and proposal, checks remaining allocation, and atomically records bet, copied legs, proposal status and ledger debit. Settlement locks the bet and atomically records status/return. Matching replays return the existing result; conflicting requests fail. Unique partial ledger indexes enforce one placement and one return per bet.
- Loss returns are zero; push/void returns equal stake. American odds below absolute 100 and invalid placement dates are rejected. Recording remains entirely separate from manual sportsbook execution.
- commissioner-api v3 is deployed. auth.js escapes member/team/selection/reference text in its HTML and disables action buttons while requests run, displaying failures instead of leaving unhandled promises.
- Service-role SELECT added for member/claim/proposal/leg records; INSERT/UPDATE for profile and commissioner membership bootstrap, bets, and required accounting writes. No browser grants or permissive RLS policies. Team-claim writes, weekly decision/proposal insertion and winner-sync writes remain missing privileges and require separate atomic workflow repair; this increment does not claim full member readiness.
- Database regression checks ran inside rolled-back transactions, before and after deployment: four settlement outcomes, duplicate retries, conflicting results, allocation/odds rejection, forced ledger failure and rollback of partial ticket changes, unauthorized actor, browser EXECUTE restriction. No simultaneous multi-session load test yet; row locks/indexes supply concurrency protection by construction.
- After tests: 0 bets, 0 proposals, 4 original ledger rows and 0 fixture Auth users. Public-key-only member/commissioner calls still return their expected 401 responses. Five Node regression tests pass, including signed odds received from form inputs. Advisors unchanged: 16 expected INFO notices and the two existing profile-trigger EXECUTE warnings.
- Remaining next work: atomic team-claim/submission flow and its grants; Auth redirect verification and actual magic-link sign-in; cost controls before hosted intelligence. Leaderboard/roast design remains in docs/LEAGUE_FEATURE_PLAN.md.

- Bank failure diagnosed: service_role lacked SELECT on all application tables. Migration 20260907123023_restore_dashboard_service_reads restores only dashboard SELECT on leagues, seasons, weekly_awards, bets, ledger_transactions, plus schema USAGE. No financial data changed. Browser roles still lack SELECT and RLS remains enabled.
- league-dashboard v4 deployed: query failures return 503/season_lookup_failed instead of a misleading missing-season response, and public bet objects no longer include private sportsbook ticket references. Its source and version manifest are updated locally.
- Live HTTP check passed: $1,400 weekly remaining, $400 futures remaining, $0 cash payouts/stakes/Bonus Bank, four ledger rows and pending Week 1 award.
- Frontend now uses server-calculated financial metrics; no sample ledger is rendered on load/failure. Outages clear stale financial/winner values. Ledger descriptions render as text. Live selection labels identify market snapshots.
- Future local env files are git-ignored; Pages builds an explicit public-file directory so backend source, tests, docs and credentials cannot accidentally be included in the site artifact.
- Commissioner email was explicitly chosen and added to the production allowlist in the intervening task. Do not put that address in this public repository. Actual sign-in still untested; service-role member/write grants remain absent and need a separate authenticated workflow repair.
- Security advisors after permission repair: unchanged 16 intentional RLS INFO notices and two trigger EXECUTE warnings. No new advisory category.
- Three local bank display regression checks passed: server metrics/empty ledger, safe text rendering, and failure/recovery. Full member accounting and paid-call protections remain unfinished.
- See docs/LEAGUE_FEATURE_PLAN.md for leaderboard/recap integration design. The baseline observations below are historical where superseded by this update.

## Identity and architecture

- Repository: https://github.com/mpsthedude/DU-Shamers-2026
- Local checkout: C:/Users/mikeston/Projects/DU-Shamers-2026 (main; clean before audit).
- Production: https://mpsthedude.github.io/DU-Shamers-2026/
- Supabase ref: xvnkwtiydyrksucgiphi; PostgreSQL, Auth and Edge Functions.
- Static vanilla frontend; no framework/build tool or test suite in the baseline.
- ESPN league 290466 / season 2026; SportsGameOdds primary market provider; DraftKings manual execution only.
- New accepted features and cost constraints: [design requirements](docs/DESIGN_REQUIREMENTS.md), including leaderboard, money attribution and weekly roast with favorable Supreme Leader prose only.

## Frontend execution map

Scripts defer in this order: Supabase JS CDN, app.js, live.js, props.js, analyzer.js, auth.js.

| File | Verified responsibility |
| --- | --- |
| index.html | Dashboard shell, allocations, builder, analyzer, sample futures, ledger, hidden commissioner section |
| app.js | Shared globals, slip and odds math, sampleEvents mutable array, sample futures/ledger, legacy localStorage demo queue |
| live.js | Public key and API roots, bank GET, NFL/NCAAF market GETs; splices live events into sampleEvents and clears current legs on successful load |
| props.js | NFL prop explorer, search/category filters, browser-lifetime cache; wraps renderMarkets; adds props to same slip |
| analyzer.js | Clones/replaces demo analysis button listener with analyze-ticket POST and factual-context rendering |
| auth.js | Magic-link session UI, claim/member API, clones/replaces demo submit listener, commissioner recording/settlement UI |
| styles.css / props.css / member.css | Base responsive layout, explorer, authentication and commissioner styles |

Do not remove sampleEvents as if it were unused demo data: it currently becomes the live event store. Demo analysis/submission functions remain in app.js but normal script loading replaces their button handlers. Failure to load auth/analyzer scripts can leave misleading demo behavior.

## Deployed Edge Functions

All nine listed ACTIVE with verify_jwt=true at audit. Their deployed source has now been exported unchanged to supabase/functions/<slug>/index.ts, with versions in supabase/deployed-functions.json. Exporting does not deploy or fix anything.

| Function | Version | Caller / behavior |
| --- | ---: | --- |
| league-dashboard | 3 | live.js GET; season/award/bets/ledger and Bonus Bank aggregation |
| draftkings-markets | 8 | live.js GET per league; available DK game ML/spread/total, 40-event provider limit per request |
| draftkings-event-props | 2 | props.js GET; full-game player offers; frontend NFL-only, backend also accepts NCAAF |
| analyze-ticket | 1 | analyzer.js public POST; up to 12 sliced legs, SGO comparison, optional external intelligence hook |
| member-api | 1 | auth.js; validates Auth user; claims and winner submissions |
| commissioner-api | 1 | auth.js; Auth + email allowlist; claim review, placement recording, settlement |
| sync-weekly-winner | 4 | GitHub scheduled POST; scheduled=true and Tuesday 9 ET gate; selects prior ESPN period, stops after Week 14 |
| draftkings-futures | 4 | No frontend caller; experimental SGO tournament/prop query, not manual portfolio CRUD |
| integration-health | 3 | No frontend caller; ESPN and SGO credential-presence/provider health checks |

Exactly six functions are referenced by frontend fetches. sync-weekly-winner is a workflow caller; the last two are not broken frontend references, but unused deployed surfaces.

## Current state and production checks

- Latest baseline Pages run 33714496940 succeeded for 1634d06. Production browser loads the shell and all 79 market events observed in this audit (counts/prices vary).
- NFL and NCAAF live market selections appear in production. Two selections from different sports could be added to the same slip with the $100 choice.
- Signed-out Submit opens the magic-link form; no proposal was created. Direct public-key-only member-api and commissioner-api requests returned 401/member_sign_in_required and 401/commissioner_sign_in_required.
- CRITICAL DISCREPANCY: expected working live bank from handoff; league-dashboard instead returns 404/season_not_found. SQL confirms the DU Shamers league and its 2026 season exist. The endpoint collapses any season-query error into that message, so the underlying failure is not yet known. Do not seed a duplicate season as a fix.
- Browser bank remains Loading live data; original sample ledger stays visible. Its failure is logged only to console. No successful live bank rendering was verified.
- Live event cards and slip incorrectly keep 'Sample DraftKings lines' / 'DraftKings sample line' labels after live replacement.
- Futures are explicitly labeled sample positions, including fabricated sample sparklines; zero actual bets exist.
- Leaderboard, earnings table and weekly recap are not implemented yet.
- Props and analyzer source inspected; fresh prop/analyzer response and full authenticated user lifecycle not yet smoke-tested in this audit. No account email was inferred, no magic link sent, and no real accounting mutation performed.

## Database and source drift

At baseline only supabase/schema.sql exists locally; no migration directory or Edge Function source. That SQL is historical and must NOT be applied as the complete production schema.

Live migration history:

1. 20260902212205 du_shamers_initial_schema
2. 20260903034310 enable_pg_net_for_edge_function_calls
3. 20260903041208 add_member_claim_workflow
4. 20260903042203 add_manual_futures_tracking

Live has 16 application tables, all RLS-enabled with zero policies. This matches the intentional controlled service-role API design. Do not add permissive policies to clear informational notices.

Local schema lacks commissioner_allowlist, team_claims, future_market_snapshots, bets.description/market_label, the team uniqueness indexes and auth trigger. The local proposal sport constraint only lists NFL/NCAAF while member-api emits FOOTBALL for mixed tickets; live constraints should be included in a complete schema export before migration work.

Live indexes enforce one active claim per profile/team and unique assigned fantasy team per league. bet_proposals has only its primary-key index: active weekly proposal uniqueness is not enforced there. Ledger has no settlement idempotency index.

Audit counts: commissioner allowlist 0; profiles 0; league members 0; team claims 0; bets 0; ledger rows 4. Auth trigger on_auth_user_created invokes public.handle_new_auth_user(). Its function has an empty search_path and inserts display_name into profiles; user metadata is not used as commissioner authorization.

Full migration SQL/schema baseline export is still required. The source export in this change covers deployed Edge Functions only.

## Security, correctness and spending findings

1. Paid-call exposure: analyzer, markets, props, futures probe and health function have no application-wide budget/rate-limit/cache gate in deployed code. Public key is sufficient at the public endpoints. Analyzer calls SGO once per distinct event, and would call configured intelligence URL on every request. Keep hosted paid intelligence disabled until the accepted cost controls are implemented. Current secret configuration of that hook has not been read.
2. Unsafe HTML interpolation: auth.js inserts editable profile display names and team/selection text into innerHTML, including commissioner claim views. Other renderers interpolate provider/ledger text similarly. Escape data or use textContent before member rollout; no exploit payload was submitted to production.
3. Placement, decisions/cash posting and settlement use multiple separate database requests; several write errors are ignored. Settlement reads OPEN then updates by ID without a status predicate/transaction and inserts a return separately. Concurrent settlement requests can double-credit; failed inserts can leave inconsistent accounting. Repair atomically and test retries before real money records.
4. Member validation verifies event start and available DK odd IDs but trusts client sport/text, does not compare the selected line to the refreshed line, slices >12 legs rather than rejecting, and derives eligibility from the latest award without binding it to the current calendar award window. Review stale-award reuse and duplicate active proposals.
5. Analyzer falls back to client-supplied odds/fair odds when provider data is absent and still labels output live market analysis. Null numeric conversions can render unavailable probabilities as 0%. Preserve missing/stale provenance rather than presenting client estimates as fresh observations.
6. Public league-dashboard response includes sportsbook_ticket_ref. Before actual tickets exist, keep ticket references commissioner-only unless explicitly intended for publication.
7. Security advisors: 16 expected RLS-without-policy INFO notices and two WARN notices for anon/authenticated EXECUTE on the SECURITY DEFINER profile trigger function. It returns trigger, so these notices alone do not demonstrate an exploitable RPC; review/restrict grants while preserving signup trigger behavior.
8. Frontend uses unpinned Supabase CDN major version; corrupted localStorage JSON can stop app.js initialization. Props cache has no TTL and switching games during fetch can overwrite active data. Track as follow-up robustness work.

## Scheduling and deployment

- .github/workflows/pages.yml deploys main on push or workflow_dispatch; currently uploads the entire repository root. No backend deployment automation exists.
- .github/workflows/tuesday-winner-sync.yml runs Tuesday 13:05 and 14:05 UTC, posting scheduled=true using the public publishable key. Function checks New York weekday/hour and ignores arbitrary requested week in favor of ESPN's prior period.
- Preserve that time/Week-14 hardening. The public schedule request is not a secret scheduler identity; repeated requests inside the window can still call ESPN and upsert. No live mutation was triggered during audit.
- Auth redirect should be production URL as Site URL and allowed redirect. Actual Auth URL settings remain unverified; commissioner email still required.
- Never commit service keys, ESPN cookies, provider keys, private API responses or member contact lists.

## Existing intelligence projects

Directories found under C:/Users/mikeston/Projects: sportsbook-intelligence-mcp-v0.1, sportsbook-intelligence-mcp-value-scanner, sportsbook-intelligence-mcp-secrets-starter. Their architecture is not yet audited; determine which is canonical and read it before designing the hosted interface. Do not copy their secrets into this project.

## Next three tasks

1. Restore/version the backend baseline and diagnose the bank query failure without changing existing data; verify Auth redirects and the chosen commissioner identity. Address unsafe member rendering and atomic proposal/settlement accounting before completing authenticated end-to-end tests.
2. Add server-wide paid-call controls, then cached ESPN leaderboard/earnings with stable team IDs and completed-week all-play calculations. Paid enrichment starts commissioner-only; recap uses the same spending gate.
3. Implement real $400 futures and the persisted weekly roast/archive; integrate existing hosted intelligence only after cost and auth controls pass.

Audit changes: requirements, this document, unchanged deployed function exports and version manifest. No production database/function/frontend behavior changed by this audit. Production bank failure remains unresolved pending diagnosis; do not describe this system as fully verified.
