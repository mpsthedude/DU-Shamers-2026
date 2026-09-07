-- Trusted Edge Function supplies verified actor and DraftKings snapshots.
alter table public.bet_proposals add column submission_key uuid unique,
  add column submission_request jsonb;
alter table public.bet_proposal_legs add column line_value numeric;
grant insert on public.weekly_decisions,public.bet_proposals,public.bet_proposal_legs to service_role;
grant update on public.weekly_awards to service_role; -- row lock only; scheduled sync still needs INSERT
create unique index weekly_one_active_proposal on public.bet_proposals(weekly_decision_id)
  where weekly_decision_id is not null and status in ('SUBMITTED','AWAITING_COMMISSIONER_PLACEMENT','PLACED');
create unique index weekly_one_cash_entry on public.ledger_transactions(weekly_award_id)
  where transaction_type='WEEKLY_HIGH_SCORE_CASH';

create function public.submit_weekly_ticket(p_actor uuid,p_season uuid,p_award uuid,
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
