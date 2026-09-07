-- Existing Edge Functions use service_role for sanitized dashboard reads.
-- RLS bypass does not grant table privileges. Do not grant browser roles access.
grant usage on schema public to service_role;
grant select on public.leagues, public.seasons, public.weekly_awards,
  public.bets, public.ledger_transactions to service_role;
