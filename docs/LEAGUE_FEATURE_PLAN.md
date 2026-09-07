# League leaderboard and weekly edition implementation plan

Design prepared 2026-09-07 against the existing Supabase functions and local intelligence source. This document defines the next implementation increments; none of the new endpoints/tables below is deployed yet.

## Page layout

Keep the current visual language. Put the league leaderboard between weekly control/bank cards and the DraftKings builder. On mobile show team, W/L/T, points and cash first; expand for all-play power ranking and wagering contribution. Add a weekly-edition teaser with week/date and a link to its complete 12-team narrative and archive. Keep the existing builder, authentication and commissioner workflow in place.

## One shared ESPN snapshot

Add a controlled server-side league snapshot job for ESPN league 290466, season 2026. Reuse the existing ESPN adapter conventions and server-side cookies; no credentials in the browser. Do not expand sync-weekly-winner into an arbitrary week-overwrite API.

Store normalized team IDs/names, matchup results, weekly scores, ESPN season records/points and source observation time. The collector must distinguish scoring weeks from multi-week matchup periods, verify completeness and finality, avoid counting a team twice, and retain revisions for score corrections. Do not infer finality just because scores are positive.

The public read endpoint serves the latest stored snapshot only. A public page view never initiates an ESPN, paid-provider or model fetch. No data shows a pending state; stale data shows its timestamp. Start with completed-week refreshes rather than promising live in-game standings.

All-play compares each team with each other team once per completed week; ties count half. With all 12 teams, one week yields 11 comparisons per team. Missing/incomplete weeks are excluded as a whole and identified in the response. Ranking uses percentage, with shared ranks for ties. No games means unranked. ESPN official W/L/T stays distinct from the calculated all-play statistic.

## Team money

Join stable team IDs through league_members and weekly_awards; then weekly_decisions/proposals/bets and ledger links. Cash recorded and shared-bank wagering contributions are separate columns.

For settled attributed tickets: gross return = settlement_return_cents; net profit = return minus stake. Loss = negative stake; push/void at full refund = zero profit. Open potential payouts remain separate. Unattributed futures stay in league totals. Ledger corrections must be included rather than summing only original winning bet records.

Before shipping these numbers, repair atomic/idempotent decision, placement and settlement writes and define correction attribution. The existing database ledger is authoritative, but current write paths can leave inconsistent records on partial failure; do not hide inconsistencies with zero defaults.

## Weekly edition

Create one draft from a complete finalized snapshot. A proposed edition record includes season/week, revision, source snapshot ID/hash, facts JSON, draft/published status, narrative by stable team ID, generated/published times and model/prompt version. Store prose as text or restricted Markdown, never raw executable HTML.

Use the same snapshot as the leaderboard. Validate every team appears exactly once and numeric claims agree with the facts. If facts cannot be validated, keep the draft unpublished. Corrections create a new edition revision and invalidate stale facts rather than silently rewriting history.

Supreme Leader's ID must first be resolved from ESPN. Its prose always gets favorable spin; actual results and ranks do not change. Preview/edit/publish in the commissioner console; homepage and archive read the persisted published version. No regeneration from public requests. No messaging integration at launch.

## Budget gate before AI

Both recap generation and fresh intelligence pass through one server-side budget gate. Default disabled until explicit monetary/request limits are set. Admission reserves bounded cost in a transaction using an idempotency key; the unique active job and shared cache prevent duplicate charges. Apply model input/output limits, concurrency limits and bounded retry counts before dispatch. A timeout does not mean the vendor did not charge: retain/reconcile uncertain reservations.

Start fresh enrichment as commissioner-only. Serving published editions or cached analysis consumes no model quota. Count provider data refresh separately from model tokens. Exhausted/disabled budgets serve cached content with timestamps or an unavailable state. No vendor fallback or automatic spending increase.

## Reuse the existing intelligence service

Inspected README and src/sportsbook_intelligence/mcp/server.py in both local folders:

- sportsbook-intelligence-mcp-v0.1
- sportsbook-intelligence-mcp-value-scanner

Both expose market movement history/feed, benchmark and other service wrappers. The value-scanner copy additionally imports services.value_scanner and exposes get_value_scan. Provider tools coexist with database-backed tools, so exposing the entire MCP to dashboard visitors would expose more capabilities than needed.

Before deployment, determine which checkout is canonical and inspect the called service implementations for paid fetches/materialization. Build a narrow authenticated HTTP adapter within that existing project, returning selected cached event/market facts with ancestry and observation times. Map SportsGameOdds IDs to its canonical entities; unmapped events return unavailable. Do not assume that identical display names establish a match. DU Shamers retains its analyze-ticket adapter and never receives provider secrets or unrestricted access to raw MCP tools.

## Delivery and verification sequence

1. Bank read repair and clear data states (current increment).
2. Auth redirects, member-role permissions, safe rendering and atomic accounting; test with approved identities without inventing real production payouts.
3. Snapshot collector and read-only leaderboard. Test incomplete weeks, ties, renamed teams, multi-week matchups, score corrections and no completed weeks.
4. Team money and actual futures. Test split/ride, losses/pushes, retries and budget boundaries in isolated fixtures.
5. Shared paid-call admission/cache and commissioner controls. Test concurrent exhaustion, duplicate jobs, bounded retries and timeout reconciliation.
6. Saved roast drafts/archive and narrow intelligence integration. Test all 12 teams, Supreme Leader prose-only bias, verified facts, and zero model calls on reads.
