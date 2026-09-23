alter table public.futures_odds_history add column source text not null default 'AUTOMATED_FEED'
  check (source in ('AUTOMATED_FEED','COMMISSIONER_SCREENSHOT'));
