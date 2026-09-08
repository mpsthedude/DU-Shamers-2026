# Daily ticket-builder feed

The NFL/college game list refreshes once daily at 12:15 UTC (7:15 a.m. Central daylight time, 6:15 a.m. Central standard time). A one-time initial run populated the list when enabled. The fixed scheduler and database slot lock prevent duplicate work within a daily cycle. There are no automatic same-day retries; failure retains the last successful snapshot for each league.

refresh-builder checks the commissioner identity through the Auth admin API and email allowlist, automatically refreshes the SportsGameOdds account usage baseline, then collects both leagues through the existing paidHandler budget gate. Up to eight 40-event pages per league are allowed; incomplete pagination does not replace a complete saved league list. Existing request/object limits, prepaid $0 cost and overall budgets apply. Disabling the provider or overall switch prevents a new scheduled run.

draftkings-markets is now a read-only endpoint serving builder_snapshots. Reads require no commissioner sign-in and make no provider calls. Started games are removed at read time. Snapshots older than 25 hours are marked delayed. Daily prices are not execution quotes; submission keeps its existing fresh-price verification. Player props and ticket analysis keep their separate short-lived caches and eligibility rules.

The browser checks the saved list every five minutes while visible, preserving an in-progress ticket. That check does not refresh provider odds or consume provider credits. The commissioner button reloads the daily list rather than making a fresh provider request.

The initial run saved 16 NFL games and 52 college games. A duplicate trigger returned not_due. Tests cover pagination, no-provider public reads, stale labels, started-game removal, daily claims and private job access. The claim was also verified using the actual service_role database role. Budget and usage policy tables remain private with RLS enabled.
