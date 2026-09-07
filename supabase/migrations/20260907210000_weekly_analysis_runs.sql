-- Disabled until commissioner configures provider budgets and validates live auth.
create table public.integration_budget (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  daily_microusd bigint not null default 0 check(daily_microusd>=0),
  monthly_microusd bigint not null default 0 check(monthly_microusd>=0)
);
insert into public.integration_budget default values;
alter table public.integration_budget enable row level security;
revoke all on public.integration_budget from anon,authenticated;
grant select,update on public.integration_budget to service_role;
-- This ceiling applies to every reservation in the provider ledger. New adapters
-- must use that ledger and add a provider-specific policy before they can be enabled.
create function public.enforce_integration_budget() returns trigger
language plpgsql security invoker set search_path='' as $$
declare b public.integration_budget%rowtype; t timestamptz; day_cost numeric; month_cost numeric;
begin
  select * into b from public.integration_budget where singleton for update;
  if not found or not b.enabled then raise exception 'integrations_disabled'; end if;
  t:=clock_timestamp();
  select coalesce(sum(reserved_microusd),0),coalesce(sum(reserved_microusd) filter(where created_at>=(date_trunc('day',t at time zone 'UTC') at time zone 'UTC')),0)
    into month_cost,day_cost from public.provider_requests
    where created_at>=(date_trunc('month',t at time zone 'UTC') at time zone 'UTC');
  if new.reserved_microusd<=0 or day_cost+new.reserved_microusd>b.daily_microusd
    or month_cost+new.reserved_microusd>b.monthly_microusd then raise exception 'integration_budget_exhausted'; end if;
  return new;
end $$;
revoke all on function public.enforce_integration_budget() from public,anon,authenticated;
create trigger integration_budget_reservation before insert on public.provider_requests
for each row execute function public.enforce_integration_budget();

create table public.analysis_policy (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  runs_per_award integer not null default 5 check(runs_per_award between 1 and 20),
  cooldown_seconds integer not null default 120 check(cooldown_seconds between 120 and 3600)
);
insert into public.analysis_policy default values;
create table public.weekly_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  award_id uuid not null references public.weekly_awards(id),
  actor uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);
create index weekly_analysis_runs_award_time on public.weekly_analysis_runs(award_id,created_at);
alter table public.analysis_policy enable row level security;
alter table public.weekly_analysis_runs enable row level security;
revoke all on public.analysis_policy,public.weekly_analysis_runs from anon,authenticated;
grant select,update on public.analysis_policy to service_role;
grant select,insert on public.weekly_analysis_runs to service_role;

create function public.reserve_weekly_analysis(p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.analysis_policy%rowtype; a public.weekly_awards%rowtype;
  t timestamptz; opens timestamptz; cutoff timestamptz; used integer; last_run timestamptz; run_id uuid;
begin
  -- Global policy lock serializes reservations, including simultaneous browser tabs.
  select * into p from public.analysis_policy where singleton for update;
  if not found or not p.enabled then raise exception 'analysis_disabled'; end if;
  t:=clock_timestamp();
  select wa.* into a from public.weekly_awards wa
    join public.seasons s on s.id=wa.season_id join public.leagues l on l.id=s.league_id
    where l.name='DU Shamers' and s.year=extract(year from t at time zone 'America/New_York')
    order by wa.week desc limit 1;
  if a.id is null or a.source_status<>'WINNER_IDENTIFIED' or a.requires_commissioner_resolution
    or a.identified_at is null then raise exception 'analysis_winner_unavailable'; end if;
  if not exists(select 1 from public.league_members m join public.seasons s on s.league_id=m.league_id
    where s.id=a.season_id and m.profile_id=p_actor and m.fantasy_team_id=a.fantasy_team_id)
    then raise exception 'analysis_winner_only'; end if;
  opens:=(date_trunc('week',a.identified_at at time zone 'America/New_York')+interval '1 day 9 hours') at time zone 'America/New_York';
  cutoff:=(date_trunc('week',a.identified_at at time zone 'America/New_York')+interval '6 days 11 hours') at time zone 'America/New_York';
  if t<opens or t>=cutoff then raise exception 'analysis_window_closed'; end if;
  select count(*),max(created_at) into used,last_run from public.weekly_analysis_runs where award_id=a.id;
  if used>=p.runs_per_award then raise exception 'analysis_weekly_limit'; end if;
  if last_run is not null and last_run+make_interval(secs=>p.cooldown_seconds)>t then raise exception 'analysis_cooldown'; end if;
  insert into public.weekly_analysis_runs(award_id,actor) values(a.id,p_actor) returning id into run_id;
  return jsonb_build_object('run_id',run_id,'remaining',p.runs_per_award-used-1);
end $$;
revoke all on function public.reserve_weekly_analysis(uuid) from public,anon,authenticated;
grant execute on function public.reserve_weekly_analysis(uuid) to service_role;
