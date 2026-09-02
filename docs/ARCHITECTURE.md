# Architecture — DU Shamers League Bank

## Product boundary

The league site is a tracking, analytics, and proposal system. It **never executes wagers**. DraftKings is the only execution sportsbook and the commissioner manually places each accepted ticket.

## Components

### 1. GitHub Pages frontend

Responsibilities:

- Public league dashboard
- Weekly winner experience
- DraftKings-focused NFL/CFB market browser
- Interactive straight-bet/parlay builder
- Bet proposal submission
- Futures portfolio and line-movement views
- League Bonus Bank and transaction ledger
- Commissioner queue UI
- Sportsbook Intelligence analysis presentation

No secret API keys may be shipped to the browser.

### 2. League API / persistence layer

Recommended implementation: Supabase Postgres + Auth + Edge Functions.

Responsibilities:

- Owner authentication
- Commissioner role enforcement
- Persistent league/week/bet/ledger state
- Protected calls to data providers
- Scheduled Tuesday winner calculation
- Bet settlement orchestration
- Audit history

### 3. Fantasy adapter

Source: existing fantasy-football MCP/server.

Required contract:

```json
{
  "season": 2026,
  "week": 4,
  "status": "final",
  "scored_at": "2026-09-29T13:00:00Z",
  "teams": [
    {
      "team_id": "...",
      "team_name": "...",
      "owner_id": "...",
      "score": 176.42
    }
  ],
  "high_scorer": {
    "team_id": "...",
    "team_name": "...",
    "owner_id": "...",
    "score": 176.42
  },
  "tie": false
}
```

The Tuesday 9:00 AM ET job should create a `weekly_award` only when the fantasy week is final. If multiple teams share the highest score, set `requires_commissioner_resolution=true`; v1 does not automate tie handling.

### 4. Odds adapter

SportsGameOdds is the primary odds/market provider. DraftKings is the authoritative bookmaker for tickets the league may actually execute.

The frontend may display consensus/other-book context, but every selectable leg must carry a DraftKings price when submitted.

Normalized leg contract:

```json
{
  "provider": "sportsgameodds",
  "bookmaker": "draftkings",
  "sport": "NFL",
  "event_id": "...",
  "market_id": "...",
  "odd_id": "...",
  "event_name": "Denver @ Los Angeles",
  "market_name": "Spread",
  "selection": "Denver +2.5",
  "american_odds": -110,
  "event_start_at": "2026-10-04T20:20:00Z",
  "observed_at": "2026-10-04T14:02:11Z"
}
```

For cross-game parlays, the UI can show an estimated combined price from individual DK legs. For same-game parlays, the combined displayed price is only an estimate until the commissioner records the actual DraftKings ticket price.

### 5. Sportsbook Intelligence adapter

The analyzer receives a proposed ticket, not a wager instruction.

Request:

```json
{
  "week": 4,
  "stake": 100,
  "execution_book": "draftkings",
  "legs": ["normalized leg objects"]
}
```

Response should separate measured facts from analysis:

```json
{
  "generated_at": "...",
  "market_summary": {
    "dk_implied_probability": 0.128,
    "consensus_fair_probability": 0.141,
    "same_game_correlation_warning": false
  },
  "legs": [
    {
      "odd_id": "...",
      "rating": "strong|positive|neutral|weak",
      "supporting_signals": [],
      "risk_signals": [],
      "market_movement": {},
      "provenance": []
    }
  ],
  "ticket_risks": [],
  "possible_alternatives": []
}
```

The analyzer must not invent an edge or win probability. A model probability may only be surfaced after a separately validated/backtested model is calibrated well enough to justify it.

## Weekly state machine

```text
PENDING_SCORE_SYNC
  -> WINNER_IDENTIFIED
  -> DECISION_REQUIRED
  -> BUILDING_BET
  -> SUBMITTED
  -> COMMISSIONER_PLACEMENT_REQUIRED
  -> OPEN
  -> WON | LOST | PUSHED | VOID
```

Important time rules:

- Winner determination: Tuesday 9:00 AM ET
- Ticket submission: before the first selected event starts
- Absolute weekly deadline: Sunday 11:00 AM ET
- College/NFL only
- DraftKings execution only

## Proposed API surface

Public/member reads:

- `GET /api/league/summary`
- `GET /api/ledger`
- `GET /api/futures`
- `GET /api/bets?week=...`
- `GET /api/weeks/:week`
- `GET /api/markets?sport=NFL|NCAAF&bookmaker=draftkings`

Authenticated weekly winner:

- `POST /api/weeks/:week/decision`
- `POST /api/bet-proposals`
- `POST /api/bet-proposals/:id/analyze`

Commissioner only:

- `POST /api/admin/bet-proposals/:id/confirm-placement`
- `POST /api/admin/bets/:id/settle`
- `POST /api/admin/weeks/:week/override-winner`
- `POST /api/admin/ledger/adjustments`

## Money model

Do not derive accounting from editable balance fields. Use an append-only transaction ledger and calculate balances from transactions.

Suggested logical accounts:

- `PRIZE_RESERVE`
- `FUTURES_ALLOCATION`
- `WEEKLY_ALLOCATION`
- `BONUS_BANK`
- `CASH_PAYOUTS`

Actual ticket odds, stake, potential return, and settlement are immutable audited facts after commissioner confirmation; corrections create adjustment/history records rather than silently overwriting financial history.
