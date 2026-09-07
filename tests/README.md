# Regression checks

Run frontend/API checks with Node 24 (uses its built-in TypeScript stripping):

```sh
node --test tests/*.test.cjs
```

The tests evaluate the actual renderer source with isolated DOM/network stubs. They do not send magic links or call paid providers.

`standings.test.cjs` checks ESPN normalization, all-play ties/completeness/deduplication, multi-week matchups and safe outage rendering. `standings.sql` requires BEGIN/ROLLBACK and the production schema/migration; it creates temporary financial fixtures to check team attribution, gross/net/open separation and refresh locking. Never commit these fixture records. No external provider is called by either test.

`provider-gate.test.cjs` executes the shared gateway and all six affected endpoints with stubbed Supabase/network calls. `provider-budget.sql` must run inside BEGIN/ROLLBACK with a disabled policy and empty provider request/cache tables, preferably in staging. It enables a tiny fictitious policy only inside that transaction and records fabricated responses. Rollback must leave the original disabled policy and zero reservations/cache/test users. Never run it standalone against an active provider budget.

`claim-api.test.cjs` also evaluates the actual Edge Function handlers with stubbed authentication context and ESPN directory data. It tests request routing and error handling, not a live authenticated session.

`team-claims.sql` follows the same BEGIN/ROLLBACK-only procedure below. It exercises the actual service_role permissions, claim ownership and league checks, retries, late cancellations, competing claims, and forced approval/self-assignment write failures. It must never persist fixtures or its temporary failure trigger.

`weekly-submissions.sql` also requires BEGIN/ROLLBACK. It temporarily replaces clock_timestamp() references in the submission RPC with a pg_temp test clock within the transaction, so deadline/DST boundaries can be checked on any day. ROLLBACK must restore the original function and remove all fixture data/triggers. Verify its deployed definition has no pg_temp reference afterward. Cases cover both choices, failed component writes, retries/conflicts, rejected replacement, cash uniqueness, placement, stale selections and budgets. These are service-role transaction tests, not simultaneous-session load tests or live sportsbook validation.

`commissioner-accounting.sql` requires the production schema and the accounting RPC migration. It creates deliberately invalid test identities and financial fixtures and must ONLY run inside a transaction ending in ROLLBACK. Never run it standalone or commit its fixtures. Prefer a staging/local database.

For the initial deployed-schema check, the agent wrapped the file in `BEGIN; SET LOCAL statement_timeout = '15s'; ... ROLLBACK;` through the SQL connector. The tests verify placement/settlement replay, conflicting records, each settlement outcome, forced ledger failure with transaction rollback, allocation/odds rejection and RPC permissions. Counts were checked afterward to verify that no test identities, proposals, bets or ledger rows persisted.

These tests do not establish an authenticated browser end-to-end pass or a multi-session concurrency stress test. The real commissioner must use the normal magic-link flow; do not generate impersonation sessions for testing.
Winner synchronization: execute `tests/winner-sync.sql` inside a single `BEGIN` / `ROLLBACK` transaction. It temporarily replaces RPC clocks and installs a failure trigger for that transaction only. Never commit the fixture transaction. Covers leases/cooldown, completed-score selection, corrected/tied results, immutable decision/ledger preservation, placement review blocking, atomic snapshot failure and Week 14 limits. Run `node --test tests/*.test.cjs` for endpoint and browser regressions.
Weekly editions: execute `tests/editions.sql` inside one `BEGIN` / `ROLLBACK` transaction. Checks private drafts, authorization, team completeness, editing conflicts, fixed Supreme Leader prose, numeric-claim publication gate, immutable publication, correction detection and atomic replacement revisions. No real edition is published by the fixtures.
