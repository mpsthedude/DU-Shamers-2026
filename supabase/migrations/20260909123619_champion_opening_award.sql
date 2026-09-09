-- Award slot 1 is reserved for the previous champion; ESPN weeks 1-13 fund slots 2-14.
alter table public.weekly_awards add column award_basis text not null default 'ESPN_HIGH_SCORE'
  check(award_basis in ('ESPN_HIGH_SCORE','PREVIOUS_CHAMPION'));
alter table public.weekly_awards add constraint champion_opening_slot check(award_basis<>'PREVIOUS_CHAMPION' or (week=1 and score is null));
create or replace function public.submit_weekly_ticket(p_actor uuid,p_season uuid,p_award uuid,
  p_request uuid,p_choice text,p_request_body jsonb,p_legs jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  s public.seasons%rowtype; a public.weekly_awards%rowtype;
  m public.league_members%rowtype; d public.weekly_decisions%rowtype; p public.bet_proposals%rowtype;
  t timestamptz := clock_timestamp();
  opens timestamptz; deadline timestamptz; cash integer; wager integer; available bigint;
  first_start timestamptz; sport_name text; l jsonb; idx integer:=0;
begin
  if p_request is null or p_request_body is null or jsonb_typeof(p_request_body)<>'object'
    or pg_column_size(p_request_body)>24000 then raise exception 'invalid_submission'; end if;
  if p_choice is null or p_choice not in ('SPLIT_50_50','LET_IT_RIDE_100') then raise exception 'invalid_weekly_choice'; end if;
  select * into s from public.seasons where id=p_season for update;
  if not found then raise exception 'season_not_found'; end if;
  t := clock_timestamp();
  select * into m from public.league_members where league_id=s.league_id and profile_id=p_actor;
  if m.id is null or m.fantasy_team_id is null then raise exception 'approved_team_membership_required'; end if;
  select * into p from public.bet_proposals where submission_key=p_request;
  if p.id is not null then
    if p.submitted_by<>m.id or p.season_id<>p_season or p.submission_request is distinct from p_request_body then
      raise exception 'submission_retry_conflict';
    end if;
    select * into d from public.weekly_decisions where id=p.weekly_decision_id;
    if d.weekly_award_id<>p_award or d.choice<>p_choice then raise exception 'submission_retry_conflict'; end if;
    return jsonb_build_object('ok',true,'proposal',to_jsonb(p),'replayed',true,
      'choice',d.choice,'cash_payout_cents',d.cash_payout_cents,'wager_budget_cents',d.wager_budget_cents);
  end if;
  select * into a from public.weekly_awards where id=p_award and season_id=p_season for update;
  if a.id is null or a.source_status<>'WINNER_IDENTIFIED' or a.requires_commissioner_resolution
    or a.week not between 1 and 14 or a.identified_at is null or a.source_observed_at is null then
    raise exception 'weekly_winner_not_ready'; end if;
  if a.fantasy_team_id is distinct from m.fantasy_team_id then raise exception 'not_this_weeks_high_scorer'; end if;
  if exists(select 1 from public.weekly_awards where season_id=p_season and week>a.week) then raise exception 'stale_weekly_award'; end if;
  opens := (date_trunc('week',a.identified_at at time zone 'America/New_York')+interval '1 day 9 hours') at time zone 'America/New_York';
  deadline := (date_trunc('week',a.identified_at at time zone 'America/New_York')+interval '6 days 11 hours') at time zone 'America/New_York';
  if t<opens or t>=deadline or a.identified_at>t or a.source_observed_at<opens or a.source_observed_at>t
    or extract(year from a.identified_at at time zone 'America/New_York')<>s.year then
    raise exception 'weekly_submission_window_closed'; end if;
  if a.award_basis='PREVIOUS_CHAMPION' and p_choice<>'LET_IT_RIDE_100' then
    raise exception 'champion_full_wager_required'; end if;
  cash:=case p_choice when 'SPLIT_50_50' then 5000 else 0 end;
  wager:=10000-cash;
  select * into d from public.weekly_decisions where weekly_award_id=p_award;
  if d.id is not null and (d.member_id<>m.id or d.choice<>p_choice) then raise exception 'weekly_decision_already_locked'; end if;
  if d.id is not null and exists(select 1 from public.bet_proposals where weekly_decision_id=d.id
    and status in ('SUBMITTED','AWAITING_COMMISSIONER_PLACEMENT','PLACED')) then raise exception 'weekly_ticket_already_submitted'; end if;
  select s.weekly_budget_cents+coalesce(sum(amount_cents),0) into available
    from public.ledger_transactions where season_id=p_season and account in ('WEEKLY_ALLOCATION','CASH_PAYOUTS') and amount_cents<0;
  if wager+(case when d.id is null then cash else 0 end)>available then raise exception 'allocation_exceeded'; end if;
  -- Preflight rejects ineligible/duplicate requests before calling a paid provider.
  if p_legs is null then return jsonb_build_object('validation_required',true); end if;
  if jsonb_typeof(p_legs)<>'array' or jsonb_array_length(p_legs) not between 1 and 12 then raise exception 'invalid_legs'; end if;
  if (select count(distinct (x->>'event_id',x->>'odd_id')) from jsonb_array_elements(p_legs) x)<>jsonb_array_length(p_legs)
    then raise exception 'duplicate_selection'; end if;
  for l in select value from jsonb_array_elements(p_legs) loop
    if coalesce(l->>'sport','') not in ('NFL','NCAAF') or coalesce(l->>'event_id','')='' or coalesce(l->>'odd_id','')=''
      or coalesce(l->>'selection','')='' or coalesce(l->>'event_name','')='' or coalesce(l->>'market_name','')=''
      or (l->>'american_odds') is null or abs((l->>'american_odds')::numeric)<100
      or (l->>'event_start_at') is null or not isfinite((l->>'event_start_at')::timestamptz)
      or (l->>'event_start_at')::timestamptz<=t
      or (l->>'observed_at') is null or (l->>'observed_at')::timestamptz>t
      or (l->>'observed_at')::timestamptz<t-interval '2 minutes' then raise exception 'invalid_or_stale_selection'; end if;
  end loop;
  if d.id is null then
    insert into public.weekly_decisions(weekly_award_id,member_id,choice,cash_payout_cents,wager_budget_cents)
      values(p_award,m.id,p_choice,cash,wager) returning * into d;
    if cash>0 then
      insert into public.ledger_transactions(season_id,account,transaction_type,amount_cents,weekly_award_id,description,created_by,occurred_at)
        values(p_season,'CASH_PAYOUTS','WEEKLY_HIGH_SCORE_CASH',-cash,p_award,'Week '||a.week||' high-score cash allocation',p_actor,t);
    end if;
  end if;
  select min((x->>'event_start_at')::timestamptz),
    case when count(distinct x->>'sport')=1 then min(x->>'sport') else 'FOOTBALL' end into first_start,sport_name
    from jsonb_array_elements(p_legs) x;
  insert into public.bet_proposals(season_id,weekly_decision_id,submitted_by,category,sport,execution_book,proposed_stake_cents,
    status,first_event_start_at,hard_deadline_at,submitted_at,submission_key,submission_request)
    values(p_season,d.id,m.id,'WEEKLY',sport_name,'draftkings',wager,'AWAITING_COMMISSIONER_PLACEMENT',
      first_start,deadline,t,p_request,p_request_body) returning * into p;
  for l in select value from jsonb_array_elements(p_legs) loop
    insert into public.bet_proposal_legs(proposal_id,provider,bookmaker,sport,event_id,odd_id,event_name,market_name,
      selection,american_odds,line_value,event_start_at,observed_at,sort_order)
      values(p.id,'sportsgameodds','draftkings',l->>'sport',l->>'event_id',l->>'odd_id',l->>'event_name',l->>'market_name',
        l->>'selection',(l->>'american_odds')::integer,(l->>'line_value')::numeric,
        (l->>'event_start_at')::timestamptz,(l->>'observed_at')::timestamptz,idx);
    idx:=idx+1;
  end loop;
  return jsonb_build_object('ok',true,'proposal',to_jsonb(p),'replayed',false,
    'choice',p_choice,'cash_payout_cents',cash,'wager_budget_cents',wager);
end;
$$;
revoke all on function public.submit_weekly_ticket(uuid,uuid,uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.submit_weekly_ticket(uuid,uuid,uuid,uuid,text,jsonb,jsonb) to service_role;

create or replace function public.finish_weekly_sync(p_season uuid,p_lease uuid,p_hash text,p_payload jsonb)
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
  elsif w>13 then result:=jsonb_build_object('ok',true,'skipped','weekly_award_program_complete','week',w);
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
      select * into a from public.weekly_awards where season_id=p_season and week=w+1 for update;
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
        values(p_season,w+1,winner_id,winner_name,high,case when tied then 'COMMISSIONER_RESOLUTION_REQUIRED' else 'WINNER_IDENTIFIED' end,
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
