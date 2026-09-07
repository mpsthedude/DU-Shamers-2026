# DU Shamers 2026: verified project handoff

Audit date: 2026-09-07. Baseline git commit: 1634d06984576b14ff893d70f87a646e6cb2e12e. Source is authoritative over prior narrative handoffs; distinguish inspected code, live observations and untested paths below.

## Repair update: 2026-09-07

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
