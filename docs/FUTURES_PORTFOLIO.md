# Recorded futures portfolio

The dashboard renders all FUTURE bets from league-dashboard, with individual ticket odds, stake, return if won, and official settlement return when settled. The grid expands without a fixed position count. There is no live futures odds or cash-out feed.

On September 7, 2026, five commissioner-provided DraftKings screenshot tickets were recorded atomically: Detroit Lions ($100, +1900, $2,000 return), LSU ($100, +1400, $1,500), Minnesota Vikings ($50, +5000, $2,550), Dallas Cowboys ($50, +2500, $1,300), and Cincinnati Bengals AFC winner ($100, +850, $950). Detroit appeared twice in the screenshots and was imported once. The NFL season-winner market label is preserved from the tickets.

The $400 total exhausts the existing futures allocation. Each bet has a matching negative BET_PLACED ledger entry. No payout has been booked; incompatible winner tickets are not summed into a portfolio payout. No provider credits are consumed by this display.

These manual records have no proposal or provider event ID. Known sportsbook references remain private; cropped references remain null. Because screenshot timezones were unavailable, the required placed_at field records import time, explicitly documented in private ledger metadata. No exact placement time or event schedule is shown in the portfolio. Commissioner settlement uses the existing bet settlement transaction.

The private import script in .local/import-futures.sql locks the season, checks commissioner membership, validates payouts and remaining allocation, and uses per-ticket import keys for replay protection. A rollback test ran the import twice and verified five tickets totaling 40,000 cents before the committed import. Production totals were verified afterward.

Validation: 60 Node tests passed, including futures rendering, official zero returns, escaping, and empty/unavailable states. Desktop and mobile browser checks verified five cards and no horizontal overflow. The API exposes curated descriptions and leg labels, not sportsbook references or screenshots.
