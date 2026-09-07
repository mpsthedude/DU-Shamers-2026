# Regression checks

Run frontend/API checks with Node 24 (uses its built-in TypeScript stripping):

```sh
node --test tests/*.test.cjs
```

The tests evaluate the actual renderer source with isolated DOM/network stubs. They do not send magic links or call paid providers.

`claim-api.test.cjs` also evaluates the actual Edge Function handlers with stubbed authentication context and ESPN directory data. It tests request routing and error handling, not a live authenticated session.

`team-claims.sql` follows the same BEGIN/ROLLBACK-only procedure below. It exercises the actual service_role permissions, claim ownership and league checks, retries, late cancellations, competing claims, and forced approval/self-assignment write failures. It must never persist fixtures or its temporary failure trigger.

`commissioner-accounting.sql` requires the production schema and the accounting RPC migration. It creates deliberately invalid test identities and financial fixtures and must ONLY run inside a transaction ending in ROLLBACK. Never run it standalone or commit its fixtures. Prefer a staging/local database.

For the initial deployed-schema check, the agent wrapped the file in `BEGIN; SET LOCAL statement_timeout = '15s'; ... ROLLBACK;` through the SQL connector. The tests verify placement/settlement replay, conflicting records, each settlement outcome, forced ledger failure with transaction rollback, allocation/odds rejection and RPC permissions. Counts were checked afterward to verify that no test identities, proposals, bets or ledger rows persisted.

These tests do not establish an authenticated browser end-to-end pass or a multi-session concurrency stress test. The real commissioner must use the normal magic-link flow; do not generate impersonation sessions for testing.
