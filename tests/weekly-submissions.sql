-- BEGIN/ROLLBACK ONLY. Replaces the RPC clock inside this test transaction,
-- then rollback restores the production function; no test clock parameter is deployed.
create function pg_temp.weekly_test_now() returns timestamptz language sql as $$
  select current_setting('du_shamers.weekly_test_time')::timestamptz;
$$;
do $$ begin
  execute replace(pg_get_functiondef('public.submit_weekly_ticket(uuid,uuid,uuid,uuid,text,jsonb,jsonb)'::regprocedure),
    'clock_timestamp()', 'pg_temp.weekly_test_now()');
end $$;
create function pg_temp.fail_weekly_write() returns trigger language plpgsql as $$
begin
  if current_setting('du_shamers.fail_weekly_table',true)=tg_table_name then raise exception 'test_weekly_write_failure'; end if;
  return new;
end $$;
create trigger weekly_test_cash before insert on public.ledger_transactions for each row execute function pg_temp.fail_weekly_write();
create trigger weekly_test_proposal before insert on public.bet_proposals for each row execute function pg_temp.fail_weekly_write();
create trigger weekly_test_legs before insert on public.bet_proposal_legs for each row execute function pg_temp.fail_weekly_write();

do $$
declare
  actor uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid();
  league uuid:=gen_random_uuid(); season uuid; award uuid; request uuid; proposal uuid;
  choice text; failure_table text; r jsonb; legs jsonb; body jsonb;
  expected_cash integer; stake integer; stamp text;
begin
  insert into auth.users(id,email) values(actor,actor::text||'@example.invalid'),(stranger,stranger::text||'@example.invalid');
  insert into public.leagues(id,name) values(league,'Rollback weekly fixture');
  insert into public.league_members(league_id,profile_id,fantasy_team_id,role) values
    (league,actor,'1','COMMISSIONER'),(league,stranger,'2','OWNER');
  foreach choice in array array['SPLIT_50_50','LET_IT_RIDE_100'] loop
    reset role;
    season:=gen_random_uuid(); award:=gen_random_uuid(); request:=gen_random_uuid();
    insert into public.seasons(id,league_id,year) values(season,league,case choice when 'SPLIT_50_50' then 2026 else 2027 end);
    insert into public.weekly_awards(id,season_id,week,fantasy_team_id,source_status,identified_at,source_observed_at)
      values(award,season,1,'1','WINNER_IDENTIFIED',
        case choice when 'SPLIT_50_50' then '2026-09-15 13:00Z'::timestamptz else '2027-09-14 13:00Z'::timestamptz end,
        case choice when 'SPLIT_50_50' then '2026-09-15 13:00Z'::timestamptz else '2027-09-14 13:00Z'::timestamptz end);
    stamp:=case choice when 'SPLIT_50_50' then '2026-09-15 14:00Z' else '2027-09-14 14:00Z' end;
    perform set_config('du_shamers.weekly_test_time',stamp,true);
    legs:=jsonb_build_array(jsonb_build_object('sport','NFL','event_id','fixture','odd_id','points-home-game-ml-home',
      'event_name','Away @ Home','market_name','Moneyline','selection','Home moneyline','american_odds',150,'line_value',null,
      'event_start_at',stamp::timestamptz+interval '2 days','observed_at',stamp::timestamptz));
    body:=jsonb_build_object('award_id',award,'choice',choice,'legs',legs);
    expected_cash:=case choice when 'SPLIT_50_50' then 5000 else 0 end;
    stake:=10000-expected_cash;
    set local role service_role;
    r:=public.submit_weekly_ticket(actor,season,award,request,choice,body);
    if r->>'validation_required'<>'true' then raise exception 'preflight_failed'; end if;
    begin
      perform public.submit_weekly_ticket(stranger,season,award,request,choice,body,legs);
      raise exception 'expected_wrong_winner';
    exception when others then if sqlerrm<>'not_this_weeks_high_scorer' then raise; end if; end;
    foreach failure_table in array array['bet_proposals','bet_proposal_legs'] loop
      perform set_config('du_shamers.fail_weekly_table',failure_table,true);
      begin
        perform public.submit_weekly_ticket(actor,season,award,request,choice,body,legs);
        raise exception 'expected_atomic_failure';
      exception when others then if sqlerrm<>'test_weekly_write_failure' then raise; end if; end;
      if exists(select 1 from public.weekly_decisions where weekly_award_id=award)
        or exists(select 1 from public.ledger_transactions where weekly_award_id=award)
        or exists(select 1 from public.bet_proposals where season_id=season) then raise exception 'partial_submission'; end if;
    end loop;
    if expected_cash>0 then
      perform set_config('du_shamers.fail_weekly_table','ledger_transactions',true);
      begin
        perform public.submit_weekly_ticket(actor,season,award,request,choice,body,legs);
        raise exception 'expected_cash_failure';
      exception when others then if sqlerrm<>'test_weekly_write_failure' then raise; end if; end;
      if exists(select 1 from public.weekly_decisions where weekly_award_id=award) then raise exception 'partial_cash_decision'; end if;
    end if;
    perform set_config('du_shamers.fail_weekly_table','',true);
    r:=public.submit_weekly_ticket(actor,season,award,request,choice,body,legs); proposal:=(r->'proposal'->>'id')::uuid;
    r:=public.submit_weekly_ticket(actor,season,award,request,choice,body);
    if r->>'replayed'<>'true' or (r->>'wager_budget_cents')::integer<>stake then raise exception 'replay_failed'; end if;
    begin
      perform public.submit_weekly_ticket(actor,season,award,request,choice,body||'{"changed":true}'::jsonb);
      raise exception 'expected_retry_conflict';
    exception when others then if sqlerrm<>'submission_retry_conflict' then raise; end if; end;
    begin
      perform public.submit_weekly_ticket(actor,season,award,gen_random_uuid(),choice,body);
      raise exception 'expected_active_conflict';
    exception when others then if sqlerrm<>'weekly_ticket_already_submitted' then raise; end if; end;
    update public.bet_proposals set status='REJECTED' where id=proposal;
    begin
      perform public.submit_weekly_ticket(actor,season,award,gen_random_uuid(),
        case choice when 'SPLIT_50_50' then 'LET_IT_RIDE_100' else 'SPLIT_50_50' end,body);
      raise exception 'expected_choice_lock';
    exception when others then if sqlerrm<>'weekly_decision_already_locked' then raise; end if; end;
    r:=public.submit_weekly_ticket(actor,season,award,gen_random_uuid(),choice,body,legs);
    proposal:=(r->'proposal'->>'id')::uuid;
    if (select count(*) from public.weekly_decisions where weekly_award_id=award)<>1
      or (select coalesce(sum(-amount_cents),0) from public.ledger_transactions where weekly_award_id=award)<>expected_cash
      then raise exception 'duplicate_cash_or_decision'; end if;
    perform public.record_ticket_placement(actor,season,proposal,150,'rollback weekly ticket');
    if (select stake_cents from public.bets where proposal_id=proposal)<>stake then raise exception 'wrong_stake'; end if;
    perform set_config('du_shamers.weekly_test_time',(stamp::timestamptz+interval '8 days')::text,true);
    r:=public.submit_weekly_ticket(actor,season,award,request,choice,body);
    if r->>'replayed'<>'true' then raise exception 'late_replay_failed'; end if;
  end loop;
  reset role;
  -- Separate clean award for actual preflight time-boundary checks.
  season:=gen_random_uuid(); award:=gen_random_uuid();
  insert into public.leagues(id,name) values(season,'Rollback boundary league');
  insert into public.league_members(league_id,profile_id,fantasy_team_id) values(season,actor,'1');
  insert into public.seasons(id,league_id,year) values(season,season,2026);
  insert into public.weekly_awards(id,season_id,week,fantasy_team_id,source_status,identified_at,source_observed_at)
    values(award,season,1,'1','WINNER_IDENTIFIED','2026-10-27 13:00Z','2026-10-27 13:00Z');
  set local role service_role;
  foreach stamp in array array['2026-10-27 12:59:59Z','2026-11-01 16:00:00Z','2026-11-02 14:00Z','2026-11-03 14:00Z'] loop
    perform set_config('du_shamers.weekly_test_time',stamp,true);
    begin
      perform public.submit_weekly_ticket(actor,season,award,gen_random_uuid(),'SPLIT_50_50','{}');
      raise exception 'expected_closed_window';
    exception when others then if sqlerrm<>'weekly_submission_window_closed' then raise; end if; end;
  end loop;
  foreach stamp in array array['2026-10-27 13:00:00Z','2026-11-01 15:59:59Z'] loop
    perform set_config('du_shamers.weekly_test_time',stamp,true);
    r:=public.submit_weekly_ticket(actor,season,award,gen_random_uuid(),'SPLIT_50_50','{}');
    if r->>'validation_required'<>'true' then raise exception 'expected_open_window'; end if;
  end loop;
  begin
    perform public.submit_weekly_ticket(actor,season,award,gen_random_uuid(),'SPLIT_50_50','{}',legs);
    raise exception 'expected_stale_selection';
  exception when others then if sqlerrm<>'invalid_or_stale_selection' then raise; end if; end;
  insert into public.ledger_transactions(season_id,account,transaction_type,amount_cents,description,occurred_at)
    values(season,'WEEKLY_ALLOCATION','TEST_FIXTURE',-140000,'Rollback allocation fixture',now());
  begin
    perform public.submit_weekly_ticket(actor,season,award,gen_random_uuid(),'SPLIT_50_50','{}');
    raise exception 'expected_budget_check';
  exception when others then if sqlerrm<>'allocation_exceeded' then raise; end if; end;
  if has_function_privilege('anon','public.submit_weekly_ticket(uuid,uuid,uuid,uuid,text,jsonb,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.submit_weekly_ticket(uuid,uuid,uuid,uuid,text,jsonb,jsonb)','EXECUTE')
    then raise exception 'browser_rpc_exposed'; end if;
  reset role;
end $$;
