# Regression checks

Run frontend checks with Node:

```sh
node --test tests/*.test.cjs
```

The tests evaluate the actual renderer source with isolated DOM/network stubs. They do not send magic links or call paid providers.

`commissioner-accounting.sql` requires the production schema and the accounting RPC migration. It creates deliberately invalid test identities and financial fixtures and must ONLY run inside a transaction ending in ROLLBACK. Never run it standalone or commit its fixtures. Prefer a staging/local database.

For the initial deployed-schema check, the agent wrapped the file in `BEGIN; SET LOCAL statement_timeout = '15s'; ... ROLLBACK;` through the SQL connector. The tests verify placement/settlement replay, conflicting records, each settlement outcome, forced ledger failure with transaction rollback, allocation/odds rejection and RPC permissions. Counts were checked afterward to verify that no test identities, proposals, bets or ledger rows persisted.

These tests do not establish an authenticated browser end-to-end pass or a multi-session concurrency stress test. The real commissioner must use the normal magic-link flow; do not generate impersonation sessions for testing.
