# DU Shamers 2026 — League Bank

A league-facing bankroll and wagering dashboard for the **DU Shamers** fantasy football league.

## League economics

- 12 teams × $300 buy-in = **$3,600 starting pool**
- 1st place: **$1,000**
- 2nd place: **$500**
- 3rd place: **$300**
- Season-long football futures allocation: **$400**
- Weekly high-score program: **14 weeks × $100 = $1,400**

Each weekly high scorer chooses one of two options:

1. **$50 cash + $50 wager**
2. **Let It Ride: $0 cash + $100 wager**

Wagers are limited to **NFL and college football**. DraftKings is the execution sportsbook. The website does **not** place bets; the commissioner places every ticket manually and records the final DraftKings ticket/price.

All gambling returns flow into the **League Bonus Bank**, which can later be distributed or used for additional league-approved wagers such as Super Bowl bets.

## Weekly workflow

1. Tuesday at **9:00 AM ET**, the fantasy integration identifies the previous week's highest-scoring team.
2. The weekly winner receives control of $100 and chooses $50/$50 or Let It Ride.
3. The winner builds a DraftKings-focused wager or parlay in the site.
4. The proposed ticket can be sent to the Sportsbook Intelligence analyzer for market context, risks, correlations, and supporting/contrary signals.
5. The winner submits the wager before its first selected event begins, with an absolute weekly cutoff of **Sunday 11:00 AM ET**.
6. The commissioner places the wager manually in DraftKings and confirms the actual odds/ticket details.
7. The dashboard tracks each leg and settlement.
8. Returns are credited to the League Bonus Bank.

Ties for weekly high score are deliberately not automated in v1. They are flagged for commissioner resolution.

## Architecture

The public GitHub Pages app never contains sportsbook or data-provider secrets.

```text
DU Shamers Web App (GitHub Pages)
        |
        +--> League API / Supabase
        |       +--> Auth + roles
        |       +--> Ledger + bets
        |       +--> Scheduled jobs
        |
        +--> Fantasy Football MCP adapter
        |       +--> weekly scores / teams
        |
        +--> Odds adapter
        |       +--> SportsGameOdds
        |       +--> DraftKings authoritative pricing
        |
        +--> Sportsbook Intelligence MCP
                +--> market movement
                +--> news / injury / weather signals
                +--> analysis with provenance
```

## v1 frontend

The first implementation intentionally uses demo data and local browser state. This lets us validate the league experience before connecting protected services.

Planned integration phases:

- **Phase 1:** interactive dashboard and bankroll UX
- **Phase 2:** persistent database + owner/commissioner authentication
- **Phase 3:** Tuesday weekly-winner automation from fantasy MCP
- **Phase 4:** live DraftKings odds/props through the odds service
- **Phase 5:** Sportsbook Intelligence analyzer integration
- **Phase 6:** live settlement, leg tracking, screenshots, notifications

## Safety / execution boundary

This project is a **read-only analytics, tracking, and decision-support application**. It does not hold sportsbook credentials, transfer gambling funds, or place/modify/cancel wagers. The commissioner remains the only person who executes tickets in DraftKings.
