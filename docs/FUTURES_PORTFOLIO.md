# Futures portfolio and automatic weekly prices

Five commissioner-provided DraftKings tickets total $400: Detroit +1900 / $100; LSU +1400 / $100; Minnesota +5000 / $50; Dallas +2500 / $50; Cincinnati AFC winner +850 / $100. Detroit's duplicated screenshot was imported once. Original odds, stakes and payouts remain unchanged by market observations. Private ledger import metadata documents that required placement timestamps are recording times because exact screenshot timezones were unavailable.

## Automatic feed

The existing THE_ODDS_API_KEY was validated against The Odds API v4. Live DraftKings outrights cover the NFL Super Bowl winner and college national championship markets, including Detroit, Minnesota, Dallas and LSU. Cincinnati's AFC winner is not listed in the provider's sport catalog. Its card explicitly shows unavailable coverage; a Super Bowl price is never substituted.

Exact mappings are stored in futures_feed_mapping, including immutable season event ID, sport key and outcome name. They must be verified once for new tickets by development; commissioners do not enter weekly prices. The current four mappings were verified against live provider responses on September 7, 2026. A different season event is rejected, even if it has the same team name.

The server-only refresh-futures worker runs from Supabase Cron hourly at minute 17. claim_futures_refresh checks the latest completed fantasy week from the standings snapshot saved by the existing Tuesday ESPN winner sync. It calls the odds provider only once per successfully saved week, with an initial week-0 baseline. Week confirmation must be at most 36 hours old. Checks stop after February 2027 or when supported tickets are settled.

The initial live worker run saved four prices and a repeated trigger returned week_saved without another provider request. Initial prices matched all four ticket odds. No historical market movement was invented.

## Cost and security

Two shared requests fetch all four supported tickets. Each run reserves its request count before dispatch under a database lock. Hard limits: 30 requests per UTC calendar month, at most three attempts per fantasy week, at least 12 hours between attempts. Failures keep their reservations; no automatic paid upgrades, AI calls, or per-viewer requests. This uses the existing Odds API allowance, independently of the SportsGameOdds object budget. Two exploratory odds requests preceded activation; the first production run reserved two more requests.

The provider key is encrypted in Supabase Vault under du_shamers_futures_odds_key. A narrowly scoped private function exposes only that named credential to the server job. No browser role has execute permission on the job claim or secret accessor. All new tables have RLS and no public client grants. The public trigger accepts only a fixed scheduled request; it cannot choose bets, markets, weeks or a provider URL. The dashboard exposes curated prices, timestamps and coverage, never credentials.

Advisors report the intentional server-only tables as RLS-without-policies INFO. The pre-existing leaked-password-protection warning remains unrelated to this feed: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Display and failure behavior

Cards compare ticket odds with latest observed odds, show the implied percentage-point change, a graph, dated observations and an expandable history. Implied percentages include sportsbook margin and are not true-probability estimates, cash-out valuations or model recommendations. Payouts remain fixed; incompatible winner payouts are not aggregated.

Only DraftKings outrights with exact matching event, market and outcome are stored. Missing, suspended, stale (over 24 hours at collection), malformed, or wrong-season prices do not become zero. Failed refreshes preserve the previous observation. The UI flags prices older than eight days and pending weekly updates. Price history is saved once per ticket/week; bounded retries can replace a partial observation in that same week.

Validation includes Node tests for matching and movement, rollback SQL tests for duplicate runs, completed-week gating, request caps, settlement exclusions and private access, and desktop/mobile checks. No financial ledger entries or settlements are written by this feature.

Provider reference: https://the-odds-api.com/liveapi/guides/v4/
