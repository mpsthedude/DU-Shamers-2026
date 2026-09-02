-- DU Shamers 2026 — initial persistence model
-- Intended for Supabase Postgres. No sportsbook credentials or provider API keys belong in this schema or repo.

create extension if not exists pgcrypto;

create table if not exists leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  execution_book text not null default 'draftkings' check (execution_book = 'draftkings'),
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now()
);

create table if not exists seasons (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  year integer not null,
  starting_pool_cents integer not null default 360000,
  prize_reserve_cents integer not null default 180000,
  futures_budget_cents integer not null default 40000,
  weekly_budget_cents integer not null default 140000,
  weekly_award_cents integer not null default 10000,
  weekly_award_count integer not null default 14,
  winner_sync_weekday text not null default 'TUESDAY',
  winner_sync_time_local time not null default '09:00',
  hard_submission_weekday text not null default 'SUNDAY',
  hard_submission_time_local time not null default '11:00',
  created_at timestamptz not null default now(),
  unique (league_id, year),
  check (starting_pool_cents = prize_reserve_cents + futures_budget_cents + weekly_budget_cents)
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists league_members (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  fantasy_team_id text,
  fantasy_team_name text,
  role text not null default 'OWNER' check (role in ('OWNER','COMMISSIONER')),
  created_at timestamptz not null default now(),
  unique (league_id, profile_id)
);

create table if not exists weekly_awards (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  week integer not null,
  winner_member_id uuid references league_members(id),
  fantasy_team_id text,
  fantasy_team_name text,
  score numeric(10,2),
  source_status text not null default 'PENDING_SCORE_SYNC' check (source_status in ('PENDING_SCORE_SYNC','WINNER_IDENTIFIED','COMMISSIONER_RESOLUTION_REQUIRED')),
  requires_commissioner_resolution boolean not null default false,
  identified_at timestamptz,
  source_observed_at timestamptz,
  source_payload jsonb,
  created_at timestamptz not null default now(),
  unique (season_id, week)
);

create table if not exists weekly_decisions (
  id uuid primary key default gen_random_uuid(),
  weekly_award_id uuid not null unique references weekly_awards(id) on delete cascade,
  member_id uuid not null references league_members(id),
  choice text not null check (choice in ('SPLIT_50_50','LET_IT_RIDE_100')),
  cash_payout_cents integer not null,
  wager_budget_cents integer not null,
  decided_at timestamptz not null default now(),
  check (
    (choice = 'SPLIT_50_50' and cash_payout_cents = 5000 and wager_budget_cents = 5000)
    or
    (choice = 'LET_IT_RIDE_100' and cash_payout_cents = 0 and wager_budget_cents = 10000)
  )
);

create table if not exists bet_proposals (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  weekly_decision_id uuid references weekly_decisions(id),
  submitted_by uuid references league_members(id),
  category text not null check (category in ('WEEKLY','FUTURE','SUPER_BOWL')),
  sport text not null check (sport in ('NFL','NCAAF')),
  execution_book text not null default 'draftkings' check (execution_book = 'draftkings'),
  proposed_stake_cents integer not null check (proposed_stake_cents > 0),
  estimated_american_odds integer,
  estimated_return_cents integer,
  status text not null default 'DRAFT' check (status in ('DRAFT','SUBMITTED','AWAITING_COMMISSIONER_PLACEMENT','PLACED','REJECTED','EXPIRED')),
  first_event_start_at timestamptz,
  hard_deadline_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists bet_proposal_legs (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references bet_proposals(id) on delete cascade,
  provider text not null default 'sportsgameodds',
  bookmaker text not null default 'draftkings' check (bookmaker = 'draftkings'),
  sport text not null check (sport in ('NFL','NCAAF')),
  event_id text not null,
  market_id text,
  odd_id text,
  event_name text not null,
  market_name text not null,
  selection text not null,
  american_odds integer not null,
  event_start_at timestamptz not null,
  observed_at timestamptz not null,
  sort_order integer not null default 0
);

create table if not exists bets (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  proposal_id uuid unique references bet_proposals(id),
  category text not null check (category in ('WEEKLY','FUTURE','SUPER_BOWL')),
  sportsbook text not null default 'draftkings' check (sportsbook = 'draftkings'),
  stake_cents integer not null check (stake_cents > 0),
  placed_american_odds integer not null,
  potential_return_cents integer not null,
  status text not null default 'OPEN' check (status in ('OPEN','WON','LOST','PUSHED','VOID')),
  sportsbook_ticket_ref text,
  ticket_screenshot_path text,
  placed_at timestamptz not null,
  settled_at timestamptz,
  settlement_return_cents integer,
  created_at timestamptz not null default now()
);

create table if not exists bet_legs (
  id uuid primary key default gen_random_uuid(),
  bet_id uuid not null references bets(id) on delete cascade,
  provider text not null default 'sportsgameodds',
  bookmaker text not null default 'draftkings',
  sport text not null check (sport in ('NFL','NCAAF')),
  event_id text not null,
  market_id text,
  odd_id text,
  event_name text not null,
  market_name text not null,
  selection text not null,
  ticket_american_odds integer,
  event_start_at timestamptz not null,
  status text not null default 'UPCOMING' check (status in ('UPCOMING','LIVE','WON','LOST','PUSHED','VOID')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists odds_snapshots (
  id bigserial primary key,
  bet_id uuid references bets(id) on delete cascade,
  bet_leg_id uuid references bet_legs(id) on delete cascade,
  provider text not null,
  bookmaker text not null,
  event_id text not null,
  market_id text,
  odd_id text,
  american_odds integer not null,
  line_value numeric,
  occurred_at timestamptz,
  published_at timestamptz,
  observed_at timestamptz not null,
  provider_updated_at timestamptz,
  raw_payload jsonb
);

create index if not exists odds_snapshots_leg_time_idx on odds_snapshots (bet_leg_id, observed_at desc);
create index if not exists odds_snapshots_event_time_idx on odds_snapshots (event_id, observed_at desc);

create table if not exists analysis_runs (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references bet_proposals(id) on delete cascade,
  analyzer_version text,
  generated_at timestamptz not null,
  dk_implied_probability numeric,
  consensus_fair_probability numeric,
  same_game_correlation_warning boolean not null default false,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  account text not null check (account in ('GENERAL_POOL','PRIZE_RESERVE','FUTURES_ALLOCATION','WEEKLY_ALLOCATION','BONUS_BANK','CASH_PAYOUTS')),
  transaction_type text not null,
  amount_cents integer not null,
  bet_id uuid references bets(id),
  weekly_award_id uuid references weekly_awards(id),
  description text not null,
  occurred_at timestamptz not null,
  created_by uuid references profiles(id),
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ledger_transactions_season_time_idx on ledger_transactions (season_id, occurred_at, created_at);

-- RLS is intentionally enabled before production auth is connected.
-- Policies should be added with these principles:
--   * league members may read their league/season/dashboard data
--   * only the weekly winner may write that week's decision/proposal
--   * only commissioners may confirm placement, settle bets, or create adjustments
--   * service-role Edge Functions perform scheduled/provider syncs

alter table profiles enable row level security;
alter table league_members enable row level security;
alter table weekly_awards enable row level security;
alter table weekly_decisions enable row level security;
alter table bet_proposals enable row level security;
alter table bet_proposal_legs enable row level security;
alter table bets enable row level security;
alter table bet_legs enable row level security;
alter table analysis_runs enable row level security;
alter table ledger_transactions enable row level security;
