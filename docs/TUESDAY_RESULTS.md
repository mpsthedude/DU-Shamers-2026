# Tuesday results refresh

Supabase Cron starts the weekly refresh at 8:00 a.m. America/Chicago each Tuesday (CST/CDT automatically), with bounded retries at 8:20 and 8:40. It runs without a local computer. GitHub's old scheduled job was removed because queue delays caused it to miss the permitted sync window.

The existing lease, final-score validation, scoring-week checks, and correction protections remain in force. Saved ESPN results update standings, points, power rankings, and the following week's bettor. The opening champion award plus thirteen winner awards still totals $1,400.

After a successful sync, the job fetches that completed week's historical ESPN matchup rosters and publishes a twelve-team recap using local writing rules, without paid AI calls. Reports include opponent and margin, leading starters, the lowest-scoring starter, eligible bench alternatives, and week-over-week scoring rank changes. Starter totals must reconcile with the saved results for all twelve teams; incomplete or inconsistent lineups stop publication rather than inventing player details. Bench comparisons exclude injured reserve and respect ESPN eligible lineup slots. They describe hindsight, not pregame advice. It preserves any already-published commissioner edition. Supreme Leader keeps favorable editorial treatment; numerical facts remain accurate.

DraftKings settlement and payout amounts remain receipt-confirmed. An ESPN refresh never invents a sportsbook payout. If results remain incomplete after the final retry, the existing data stays visible and the commissioner must retry after ESPN finalizes them. The 2026 schedule stops after December 15.
