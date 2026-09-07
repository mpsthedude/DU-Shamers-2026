# Dashboard design requirements

Accepted direction from the project owner, 2026-09-07. These are requirements, not claims that every feature is implemented. See ../PROJECT_HANDOFF.md for verified implementation status.

## Product and league rules

- Continue the existing vanilla HTML/CSS/JavaScript, GitHub Pages and Supabase system.
- 12 members contribute $300 each: $3,600 pool; $1,800 prize reserve; $1,400 weekly program; $400 futures.
- Fourteen weekly $100 high-score awards. Winner chooses $50 cash/$50 wager or $100 Let It Ride/no cash.
- ESPN league 290466, season 2026. Tuesday 9 AM America/New_York winner sync; Sunday 11 AM Eastern submission cutoff and no started selections.
- DraftKings is the only execution book. Only available DraftKings selections and their execution odds belong in the builder. Other books may supply clearly labeled analysis context.
- Commissioner manually places every real wager externally. The app only proposes, analyzes, records and accounts for tickets; never request/store DraftKings credentials or automate execution.
- Actual combined DraftKings ticket odds govern recorded returns, especially for SGPs. Independent probability multiplication is only an estimate, never a model SGP probability.

## Front-page league leaderboard

- All 12 actual ESPN teams, linked by stable ESPN team ID to approved member records. Do not join on display names alone.
- Actual W/L/T records, points for, points against, weekly high-score wins, and transparent power rankings.
- Initial proposed power formula: all-play percentage, (all-play wins + 0.5 * ties) / comparisons across completed scoring weeks. Explain methodology beside rankings; retain shared ranks for equal percentages. Before any completed week, show unranked, not fabricated rankings.
- Preserve source observation timestamps and distinguish final versus provisional results. Corrected ESPN results require a versioned refresh.
- Team money columns distinguish cash paid, settled wager gross returns, and settled net profit/loss contributed to the shared Bonus Bank. Open potential payouts are separate and are not earned money.
- Cash attribution follows weekly award/decision/member links; betting attribution follows bet -> proposal -> submitter. Unattributed league futures remain league positions unless an explicit attribution rule is adopted.
- Do not imply that Bonus Bank contributions belong to an individual owner or are immediately payable. Avoid double-counting returned stake as profit.
- Show starting allocations separately from ledger-derived actual remaining/spent balances.

## Weekly roast / league recap

- Produce one humorous weekly edition covering every team's actual performance, with a front-page teaser and link to the full edition/archive. A compact on-page presentation is also acceptable.
- Use the finalized league results for opponent, score, result, margin, weekly scoring rank and season record. Mention lineup/bench decisions only when supported by actual roster data. Never invent results, injuries, quotes or off-field stories.
- Tone: sharp, funny fantasy-football trash talk among friends, with team-specific observations rather than twelve generic paragraphs. Keep jokes about league performance and football decisions; exclude private personal information and discriminatory attacks.
- Supreme Leader always receives a favorable, comically partisan editorial spin, regardless of performance. A win is masterful leadership; a loss can be framed as a magnanimous gift or a strategic plot twist. Keep the actual loss, score, record, objective rank and money accurate.
- Make the editorial conceit recognizable as satire (for example, a mock 'Supreme Leader-approved league bulletin'). This preference affects prose only, never eligibility, rankings, accounting, or ticket analysis.
- Supreme Leader's stable ESPN team ID is 3, verified against league 290466 on 2026-09-07. Do not apply the exception to another team merely because it changes its name.
- Store a single edition per season/week with versioned corrections, source snapshot reference/hash, observed/generated/published timestamps, prompt/model version and usage metadata.
- Generate once after finalized results are available; serve the saved edition to every reader. No model call on page view, expansion, refresh or archive access.
- Initial delivery: commissioner can review/edit/publish a draft; regeneration is commissioner-only, bounded and counted against the same global budget. Do not send email or messages to league members without explicit authorization.
- If results are incomplete or the budget is unavailable, show pending/last published edition. Do not publish made-up current-week content.

## Paid API and model cost controls

- Integrate the existing Sportsbook Intelligence service through the adapter; do not build a competing engine in this repo.
- Keep every provider credential server-side. A public Supabase key is not member authentication and does not prevent quota abuse.
- Launch fresh paid intelligence as commissioner-only. Public visitors see cached market context. Later approved-member allowances require measured usage and configured limits.
- Shared server cache keyed by canonical event/market/line/source/version with explicit freshness. Deduplicate in-flight requests across instances, not just within a browser.
- Basic odds calculations and all-play rankings run in code without model calls. Refresh provider data on a bounded shared schedule or authorized cache miss; never fan out paid calls per page view.
- Enforce per-user quotas, body/leg limits, concurrency limits, retry limits and global daily/monthly provider-request and monetary allowances server-side. Unused experimental endpoints are included in the controls.
- Reserve worst-case bounded request cost atomically before dispatch; reconcile measured usage afterward. Keep reservations for ambiguous failures until reconciled. Parallel calls cannot bypass the global allowance.
- Default paid enrichment/recap generation disabled until a commissioner sets an explicit budget and a supported model/provider configuration. No dollar amount or paid subscription has been authorized by these requirements.
- Exhaustion fails closed: serve timestamped cache or unavailable state. No automatic overages, paid fallback provider, or unbounded retries.
- Commissioner console shows request/token usage, estimated versus actual costs when available, remaining allowances, and a global paid-call kill switch. Use provider-enforced caps where supported, without assuming their availability.
- Preserve provenance, source ancestry, occurred/published/observed/updated times; distinguish correlation from causation. Never invent edge percentages or credibility/confidence scores.

## Futures and member completion

- Magic links, automatic profiles, approved team claims, server-enforced winner eligibility and persistent proposals remain required.
- Commissioner recording and settlement must be atomic/idempotent; retries or simultaneous clicks must not duplicate ledger entries.
- Real commissioner-entered futures replace sample cards. Cumulative futures stakes <= $400, enforced transactionally.
- Record description, market, sport, stake, actual odds, potential return, reference, placed timestamp and status. Automatically save a placement-price snapshot; retain later manual DraftKings observations for charts.
- Do not rely on current SportsGameOdds futures availability. Preserve future snapshot source options without claiming that automation exists.

## Acceptance priorities

1. Restore reliable bank reads and verify authenticated ownership/commissioner/accounting behavior; preserve/export live backend and reconcile schema drift.
2. Close paid-call abuse paths before exposing hosted intelligence or recap generation; add cached ESPN leaderboard and team money attribution.
3. Implement real futures and the saved weekly roast; then connect hosted intelligence under the budget gate and improve mobile presentation.
