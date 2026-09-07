create table public.league_standings_snapshots (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id),
  source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  payload jsonb not null check(jsonb_typeof(payload)='object')
);
create index standings_latest on public.league_standings_snapshots(season_id,observed_at desc);
create table public.league_standings_refresh (
  season_id uuid primary key references public.seasons(id),
  lease_id uuid,
  lease_until timestamptz,
  last_attempt_at timestamptz
);
alter table public.league_standings_snapshots enable row level security;
alter table public.league_standings_refresh enable row level security;
revoke all on public.league_standings_snapshots,public.league_standings_refresh from anon,authenticated;
grant select,insert on public.league_standings_snapshots to service_role;
grant select,insert,update on public.league_standings_refresh to service_role;

create function public.begin_standings_refresh(p_season uuid,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare l uuid; r public.league_standings_refresh%rowtype; token uuid;
begin
  select league_id into l from public.seasons where id=p_season for update;
  if l is null or not exists(select 1 from public.league_members where league_id=l and profile_id=p_actor and role='COMMISSIONER')
    then raise exception 'commissioner_not_authorized'; end if;
  insert into public.league_standings_refresh(season_id) values(p_season) on conflict do nothing;
  select * into r from public.league_standings_refresh where season_id=p_season for update;
  if r.lease_until>clock_timestamp() then raise exception 'standings_refresh_in_progress'; end if;
  if r.last_attempt_at>clock_timestamp()-interval '15 minutes' then return jsonb_build_object('skipped','standings_refresh_cooldown'); end if;
  token:=gen_random_uuid();
  update public.league_standings_refresh set lease_id=token,lease_until=clock_timestamp()+interval '2 minutes',last_attempt_at=clock_timestamp()
    where season_id=p_season;
  return jsonb_build_object('lease_id',token);
end $$;
create function public.finish_standings_refresh(p_season uuid,p_lease uuid,p_hash text,p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.league_standings_refresh%rowtype; snapshot uuid;
begin
  select * into r from public.league_standings_refresh where season_id=p_season for update;
  if r.lease_id is distinct from p_lease or p_lease is null or r.lease_until<=clock_timestamp() then raise exception 'standings_refresh_expired'; end if;
  if p_payload is null or p_payload->>'espn_league_id' is distinct from '290466' or p_payload->>'year' is distinct from '2026'
    or jsonb_typeof(p_payload->'teams') is distinct from 'array' then raise exception 'invalid_standings_snapshot'; end if;
  if jsonb_array_length(p_payload->'teams')<>12 or pg_column_size(p_payload)>200000 then raise exception 'invalid_standings_snapshot'; end if;
  insert into public.league_standings_snapshots(season_id,source_hash,observed_at,payload)
    values(p_season,p_hash,clock_timestamp(),p_payload) returning id into snapshot;
  update public.league_standings_refresh set lease_id=null,lease_until=null where season_id=p_season;
  return snapshot;
end $$;
create function public.league_team_earnings(p_season uuid)
returns jsonb language sql security invoker set search_path='' as $$
  with cash as (
    select m.fantasy_team_id team_id,sum(-l.amount_cents) cash_cents
    from public.ledger_transactions l
    join public.weekly_decisions d on d.weekly_award_id=l.weekly_award_id
    join public.league_members m on m.id=d.member_id
    where l.season_id=p_season and l.transaction_type='WEEKLY_HIGH_SCORE_CASH'
      and l.account='CASH_PAYOUTS' and l.amount_cents<0
    group by m.fantasy_team_id
  ), returns as (
    select m.fantasy_team_id team_id,
      coalesce(sum(b.settlement_return_cents) filter(where b.status in ('WON','LOST','PUSHED','VOID')),0) gross_return_cents,
      coalesce(sum(b.settlement_return_cents-b.stake_cents) filter(where b.status in ('WON','LOST','PUSHED','VOID')),0) net_contribution_cents,
      coalesce(sum(b.potential_return_cents) filter(where b.status='OPEN'),0) open_potential_cents,
      coalesce(sum(b.stake_cents) filter(where b.status='OPEN'),0) open_stake_cents
    from public.bets b left join public.bet_proposals p on p.id=b.proposal_id
      left join public.league_members m on m.id=p.submitted_by
    where b.season_id=p_season group by m.fantasy_team_id
  ), teams as (
    select coalesce(c.team_id,r.team_id) team_id,coalesce(c.cash_cents,0) cash_allocated_cents,
      coalesce(r.gross_return_cents,0) gross_return_cents,coalesce(r.net_contribution_cents,0) net_contribution_cents,
      coalesce(r.open_potential_cents,0) open_potential_cents,coalesce(r.open_stake_cents,0) open_stake_cents
    from cash c full join returns r on r.team_id=c.team_id
  ) select coalesce(jsonb_agg(to_jsonb(teams)),'[]'::jsonb) from teams;
$$;
revoke all on function public.begin_standings_refresh(uuid,uuid) from public,anon,authenticated;
revoke all on function public.finish_standings_refresh(uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.league_team_earnings(uuid) from public,anon,authenticated;
grant execute on function public.begin_standings_refresh(uuid,uuid),public.finish_standings_refresh(uuid,uuid,text,jsonb),public.league_team_earnings(uuid) to service_role;
