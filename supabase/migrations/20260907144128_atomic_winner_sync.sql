-- Scheduled writes use the same season lock as member submissions and placement.
create table public.weekly_sync_state (
  season_id uuid primary key references public.seasons(id),
  lease_id uuid, lease_until timestamptz, last_attempt_at timestamptz
);
alter table public.weekly_sync_state enable row level security;
revoke all on public.weekly_sync_state from anon,authenticated;
grant select,insert,update on public.weekly_sync_state to service_role;
grant insert on public.weekly_awards to service_role;

create function public.begin_weekly_sync(p_season uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t timestamptz; local_time timestamp; state public.weekly_sync_state%rowtype;
begin
  perform 1 from public.seasons where id=p_season and year=2026 for update;
  if not found then raise exception 'season_not_found'; end if;
  t:=clock_timestamp(); local_time:=t at time zone 'America/New_York';
  if extract(isodow from local_time)<>2 or extract(hour from local_time)<>9 then
    return jsonb_build_object('skipped','outside_tuesday_9am_et_window'); end if;
  if local_time::date>date '2026-12-15' then return jsonb_build_object('skipped','weekly_award_program_complete'); end if;
  if local_time::date<date '2026-09-08' then return jsonb_build_object('skipped','season_not_started'); end if;
  insert into public.weekly_sync_state(season_id) values(p_season) on conflict do nothing;
  select * into state from public.weekly_sync_state where season_id=p_season for update;
  if state.lease_until>t then return jsonb_build_object('skipped','sync_in_progress'); end if;
  if state.last_attempt_at>t-interval '15 minutes' then return jsonb_build_object('skipped','sync_cooldown'); end if;
  update public.weekly_sync_state set lease_id=gen_random_uuid(),lease_until=t+interval '2 minutes',last_attempt_at=t
    where season_id=p_season returning * into state;
  return jsonb_build_object('lease_id',state.lease_id);
end;
$$;

create function public.finish_weekly_sync(p_season uuid,p_lease uuid,p_hash text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t timestamptz; state public.weekly_sync_state%rowtype; a public.weekly_awards%rowtype;
  w integer; expected_week integer; score_rows jsonb; winners jsonb; high numeric; winner_id text; winner_name text;
  tied boolean; locked boolean; changed boolean; result jsonb; candidate jsonb;
begin
  perform 1 from public.seasons where id=p_season and year=2026 for update;
  if not found then raise exception 'season_not_found'; end if;
  t:=clock_timestamp();
  select * into state from public.weekly_sync_state where season_id=p_season for update;
  if state.lease_id is distinct from p_lease or p_lease is null or state.lease_until is null or state.lease_until<t
    then raise exception 'sync_lease_expired'; end if;
  if extract(isodow from t at time zone 'America/New_York')<>2 or extract(hour from t at time zone 'America/New_York')<>9
    then raise exception 'sync_window_closed'; end if;
  if p_payload is null or p_hash is null or p_hash!~'^[a-f0-9]{64}$'
    or p_payload->>'espn_league_id' is distinct from '290466' or p_payload->>'year' is distinct from '2026'
    or jsonb_typeof(p_payload->'teams') is distinct from 'array' or jsonb_array_length(p_payload->'teams')<>12
    or jsonb_typeof(p_payload->'completed_weeks') is distinct from 'array' or pg_column_size(p_payload)>200000
    or coalesce(p_payload->>'scoring_period','')!~'^[1-9][0-9]*$' then raise exception 'invalid_sync_snapshot'; end if;
  w:=(p_payload->>'scoring_period')::integer-1;
  -- 2026 Week 1 ends before Tuesday September 15. Reject a frozen ESPN period:
  -- a delayed observation must never open last week's award window this week.
  expected_week:=((t at time zone 'America/New_York')::date-date '2026-09-08')/7;
  if w<>greatest(0,expected_week) then raise exception 'unexpected_scoring_week'; end if;
  if w<1 then result:=jsonb_build_object('ok',true,'skipped','no_completed_scoring_week_yet');
  elsif w>14 then result:=jsonb_build_object('ok',true,'skipped','weekly_award_program_complete','week',w);
  else
    if (select count(*) from jsonb_array_elements(p_payload->'completed_weeks') x where (x->>'week')::integer=w)>1
      then raise exception 'duplicate_scoring_week'; end if;
    select x->'scores' into score_rows from jsonb_array_elements(p_payload->'completed_weeks') x where (x->>'week')::integer=w;
    if score_rows is null then result:=jsonb_build_object('ok',false,'skipped','scores_not_finalized','week',w);
    else
      if jsonb_typeof(score_rows)<>'array' or jsonb_array_length(score_rows)<>12
        or (select count(distinct x->>'team_id') from jsonb_array_elements(score_rows) x)<>12
        or (select count(distinct x->>'team_id') from jsonb_array_elements(p_payload->'teams') x)<>12
        or exists(select 1 from jsonb_array_elements(score_rows) x where jsonb_typeof(x->'score') is distinct from 'number'
          or not exists(select 1 from jsonb_array_elements(p_payload->'teams') tm where tm->>'team_id'=x->>'team_id'))
        then raise exception 'invalid_weekly_scores'; end if;
      select max((x->>'score')::numeric) into high from jsonb_array_elements(score_rows) x;
      select jsonb_agg(x order by x->>'team_id') into winners from jsonb_array_elements(score_rows) x where (x->>'score')::numeric=high;
      tied:=jsonb_array_length(winners)>1;
      winner_id:=case when tied then null else winners->0->>'team_id' end;
      select tm->>'team_name' into winner_name from jsonb_array_elements(p_payload->'teams') tm where tm->>'team_id'=winner_id;
      if not tied and (winner_name is null or length(winner_name) not between 1 and 200) then raise exception 'invalid_winner_name'; end if;
      candidate:=jsonb_build_object('espn_league_id',290466,'year',2026,'week',w,'scores',score_rows,'winners',winners,'source_hash',p_hash);
      select * into a from public.weekly_awards where season_id=p_season and week=w for update;
      locked:=a.id is not null and (exists(select 1 from public.weekly_decisions where weekly_award_id=a.id)
        or exists(select 1 from public.ledger_transactions where weekly_award_id=a.id));
      changed:=a.fantasy_team_id is distinct from winner_id or a.score is distinct from high;
      if locked and (changed or a.requires_commissioner_resolution) then
        update public.weekly_awards set requires_commissioner_resolution=true,source_status='COMMISSIONER_RESOLUTION_REQUIRED',
          source_observed_at=t,source_payload=coalesce(source_payload,'{}'::jsonb)||jsonb_build_object('pending_correction',candidate)
          where id=a.id;
        result:=jsonb_build_object('ok',true,'week',w,'review_required',true,'reason','result_changed_after_decision');
      else
        insert into public.weekly_awards(season_id,week,fantasy_team_id,fantasy_team_name,score,source_status,
          requires_commissioner_resolution,identified_at,source_observed_at,source_payload)
        values(p_season,w,winner_id,winner_name,high,case when tied then 'COMMISSIONER_RESOLUTION_REQUIRED' else 'WINNER_IDENTIFIED' end,
          tied,t,t,candidate)
        on conflict(season_id,week) do update set fantasy_team_id=excluded.fantasy_team_id,fantasy_team_name=excluded.fantasy_team_name,
          score=excluded.score,source_status=excluded.source_status,requires_commissioner_resolution=excluded.requires_commissioner_resolution,
          identified_at=coalesce(public.weekly_awards.identified_at,excluded.identified_at),source_observed_at=t,source_payload=candidate;
        result:=jsonb_build_object('ok',true,'week',w,'tie',tied,'review_required',tied,'high_score',high,'winner_team_id',winner_id);
      end if;
    end if;
  end if;
  insert into public.league_standings_snapshots(season_id,source_hash,observed_at,payload) values(p_season,p_hash,t,p_payload);
  update public.weekly_sync_state set lease_id=null,lease_until=null where season_id=p_season;
  return result;
end;
$$;
revoke all on function public.begin_weekly_sync(uuid) from public,anon,authenticated;
revoke all on function public.finish_weekly_sync(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.begin_weekly_sync(uuid),public.finish_weekly_sync(uuid,uuid,text,jsonb) to service_role;

-- Preserve replay semantics; block new placement while its award needs review.
create or replace function public.record_ticket_placement(
  p_actor uuid, p_season uuid, p_proposal uuid, p_odds integer,
  p_ticket_ref text default null, p_placed_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_season public.seasons%rowtype;
  v_proposal public.bet_proposals%rowtype;
  v_bet public.bets%rowtype;
  v_available bigint;
  v_potential integer;
  v_account text;
  v_placed timestamptz := coalesce(p_placed_at, now());
begin
  if p_odds is null or (p_odds > -100 and p_odds < 100) then
    raise exception 'invalid_american_odds';
  end if;
  if length(p_ticket_ref) > 200 or not isfinite(v_placed) or v_placed > now() then
    raise exception 'invalid_placement_details';
  end if;
  select * into v_season from public.seasons where id = p_season for update;
  if not found then raise exception 'season_not_found'; end if;
  if not exists (select 1 from public.league_members where league_id = v_season.league_id
    and profile_id = p_actor and role = 'COMMISSIONER') then
    raise exception 'commissioner_not_authorized';
  end if;
  select * into v_proposal from public.bet_proposals
    where id = p_proposal and season_id = p_season for update;
  if not found then raise exception 'proposal_not_found'; end if;

  select * into v_bet from public.bets where proposal_id = p_proposal;
  if found then
    if v_proposal.status = 'PLACED' and v_bet.placed_american_odds = p_odds
      and v_bet.sportsbook_ticket_ref is not distinct from nullif(btrim(p_ticket_ref), '')
      and (p_placed_at is null or v_bet.placed_at = p_placed_at) then
      return jsonb_build_object('ok', true, 'bet', to_jsonb(v_bet), 'replayed', true);
    end if;
    raise exception 'placement_conflict';
  end if;
  if v_proposal.category='WEEKLY' and v_proposal.weekly_decision_id is not null and not exists (
    select 1 from public.weekly_decisions d join public.weekly_awards a on a.id=d.weekly_award_id
    where d.id=v_proposal.weekly_decision_id and a.season_id=p_season
      and a.source_status='WINNER_IDENTIFIED' and not a.requires_commissioner_resolution
  ) then raise exception 'weekly_award_review_required'; end if;
  if v_proposal.status <> 'AWAITING_COMMISSIONER_PLACEMENT' then
    raise exception 'proposal_not_awaiting_placement';
  end if;
  if not exists (select 1 from public.bet_proposal_legs where proposal_id = p_proposal) then
    raise exception 'proposal_legs_required';
  end if;
  if v_proposal.category = 'FUTURE' then
    select v_season.futures_budget_cents - coalesce(sum(stake_cents), 0)
      into v_available from public.bets where season_id = p_season and category = 'FUTURE';
    v_account := 'FUTURES_ALLOCATION';
  elsif v_proposal.category = 'SUPER_BOWL' then
    select coalesce(sum(amount_cents), 0) into v_available
      from public.ledger_transactions where season_id = p_season and account = 'BONUS_BANK';
    v_account := 'BONUS_BANK';
  else
    select v_season.weekly_budget_cents + coalesce(sum(amount_cents), 0) into v_available
      from public.ledger_transactions where season_id = p_season
      and account in ('WEEKLY_ALLOCATION','CASH_PAYOUTS') and amount_cents < 0;
    v_account := 'WEEKLY_ALLOCATION';
  end if;
  if v_proposal.proposed_stake_cents > v_available then raise exception 'allocation_exceeded'; end if;
  v_potential := round(v_proposal.proposed_stake_cents::numeric *
    case when p_odds > 0 then 1 + p_odds::numeric / 100
    else 1 + 100 / abs(p_odds::numeric) end);
  insert into public.bets (season_id, proposal_id, category, sportsbook, stake_cents,
    placed_american_odds, potential_return_cents, status, sportsbook_ticket_ref, placed_at)
  values (p_season, p_proposal, v_proposal.category, 'draftkings', v_proposal.proposed_stake_cents,
    p_odds, v_potential, 'OPEN', nullif(btrim(p_ticket_ref), ''), v_placed) returning * into v_bet;
  insert into public.bet_legs (bet_id, provider, bookmaker, sport, event_id, market_id,
    odd_id, event_name, market_name, selection, ticket_american_odds, event_start_at, status, sort_order)
  select v_bet.id, provider, 'draftkings', sport, event_id, market_id, odd_id, event_name,
    market_name, selection, american_odds, event_start_at, 'UPCOMING', sort_order
    from public.bet_proposal_legs where proposal_id = p_proposal;
  update public.bet_proposals set status = 'PLACED' where id = p_proposal;
  insert into public.ledger_transactions (season_id, account, transaction_type, amount_cents,
    bet_id, description, occurred_at, created_by, metadata)
  values (p_season, v_account, 'BET_PLACED', -v_bet.stake_cents, v_bet.id,
    v_proposal.category || ' DraftKings wager placed', v_placed, p_actor,
    jsonb_build_object('placed_american_odds', p_odds, 'sportsbook_ticket_ref', v_bet.sportsbook_ticket_ref));
  return jsonb_build_object('ok', true, 'bet', to_jsonb(v_bet), 'replayed', false);
end;
$$;
