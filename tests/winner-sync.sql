-- Run only inside BEGIN/ROLLBACK. Override both RPC clocks only in that transaction.
do $$ declare fn text; sig text; begin
  foreach sig in array array['public.begin_weekly_sync(uuid)','public.finish_weekly_sync(uuid,uuid,text,jsonb)'] loop
    select pg_get_functiondef(sig::regprocedure) into fn;
    execute replace(fn,'clock_timestamp()','current_setting(''du_test.now'')::timestamptz');
  end loop;
end $$;
create function public.fail_sync_snapshot_fixture() returns trigger language plpgsql as $$
begin if new.source_hash=repeat('f',64) then raise exception 'snapshot_fixture_failure'; end if; return new; end $$;
create trigger fail_sync_snapshot_fixture before insert on public.league_standings_snapshots
  for each row execute function public.fail_sync_snapshot_fixture();
do $$
declare actor uuid:=gen_random_uuid(); league uuid:=gen_random_uuid(); season uuid:=gen_random_uuid();
  member uuid; award uuid; decision uuid; proposal uuid; r jsonb; lease uuid; payload jsonb; initial_time timestamptz; original_payload jsonb;
begin
  insert into auth.users(id,email) values(actor,actor::text||'@example.invalid');
  insert into public.leagues(id,name) values(league,'Rollback winner sync fixture');
  insert into public.seasons(id,league_id,year) values(season,league,2026);
  insert into public.league_members(league_id,profile_id,role,fantasy_team_id) values(league,actor,'COMMISSIONER','12') returning id into member;
  payload:=jsonb_build_object('espn_league_id',290466,'year',2026,'scoring_period',2,
    'teams',(select jsonb_agg(jsonb_build_object('team_id',i::text,'team_name','Team '||i)) from generate_series(1,12) i),
    'completed_weeks',jsonb_build_array(jsonb_build_object('week',1,'scores',
      (select jsonb_agg(jsonb_build_object('team_id',i::text,'score',i)) from generate_series(1,12) i))));
  original_payload:=payload;
  insert into public.weekly_awards(season_id,week,fantasy_team_id,source_status,award_basis)
    values(season,1,'13','WINNER_IDENTIFIED','PREVIOUS_CHAMPION');
  set local role service_role;
  perform set_config('du_test.now','2026-09-14 13:05Z',true);
  r:=public.begin_weekly_sync(season);
  if r->>'skipped'<>'outside_tuesday_9am_et_window' then raise exception 'time_gate_failed'; end if;
  perform set_config('du_test.now','2026-09-15 13:05Z',true);
  r:=public.begin_weekly_sync(season);lease:=(r->>'lease_id')::uuid;
  if public.begin_weekly_sync(season)->>'skipped'<>'sync_in_progress' then raise exception 'inflight_failed'; end if;
  begin perform public.finish_weekly_sync(season,gen_random_uuid(),repeat('a',64),payload);raise exception 'expected_lease';
    exception when others then if sqlerrm<>'sync_lease_expired' then raise; end if; end;
  r:=public.finish_weekly_sync(season,lease,repeat('a',64),payload);
  select id,identified_at into award,initial_time from public.weekly_awards where season_id=season and week=2;
  if r->>'winner_team_id'<>'12' or award is null then raise exception 'winner_failed'; end if;
  if public.begin_weekly_sync(season)->>'skipped'<>'sync_cooldown' then raise exception 'cooldown_failed'; end if;
  -- Same snapshot retry must preserve the original submission window and unique award.
  update public.weekly_sync_state set last_attempt_at=null where season_id=season;
  perform set_config('du_test.now','2026-09-15 13:25Z',true);
  r:=public.begin_weekly_sync(season);lease:=(r->>'lease_id')::uuid;
  r:=public.finish_weekly_sync(season,lease,repeat('a',64),payload);
  if (select count(*) from public.weekly_awards where season_id=season)<>2
    or (select identified_at from public.weekly_awards where id=award)<>initial_time then raise exception 'retry_changed_award'; end if;
  -- A failed snapshot insert must roll back a changed award too.
  update public.weekly_sync_state set last_attempt_at=null where season_id=season;
  r:=public.begin_weekly_sync(season);lease:=(r->>'lease_id')::uuid;
  payload:=jsonb_set(payload,'{completed_weeks,0,scores,0,score}','100');
  begin perform public.finish_weekly_sync(season,lease,repeat('f',64),payload);raise exception 'expected_snapshot_failure';
    exception when others then if sqlerrm<>'snapshot_fixture_failure' then raise; end if; end;
  if (select fantasy_team_id from public.weekly_awards where id=award)<>'12' then raise exception 'partial_award_write'; end if;
  -- Before submission a corrected winner can replace the result, preserving identification time.
  r:=public.finish_weekly_sync(season,lease,repeat('b',64),payload);
  if r->>'winner_team_id'<>'1' then raise exception 'correction_failed'; end if;
  update public.weekly_sync_state set last_attempt_at=null where season_id=season;
  r:=public.begin_weekly_sync(season);lease:=(r->>'lease_id')::uuid;
  payload:=jsonb_set(payload,'{completed_weeks,0,scores,11,score}','100');
  r:=public.finish_weekly_sync(season,lease,repeat('c',64),payload);
  if r->>'tie'<>'true' or not (select requires_commissioner_resolution from public.weekly_awards where id=award)
    then raise exception 'tie_not_flagged'; end if;
  update public.weekly_sync_state set last_attempt_at=null where season_id=season;
  r:=public.begin_weekly_sync(season);lease:=(r->>'lease_id')::uuid;
  r:=public.finish_weekly_sync(season,lease,repeat('a',64),original_payload);
  insert into public.weekly_decisions(weekly_award_id,member_id,choice,cash_payout_cents,wager_budget_cents)
    values(award,member,'SPLIT_50_50',5000,5000) returning id into decision;
  insert into public.ledger_transactions(season_id,weekly_award_id,account,transaction_type,amount_cents,description,occurred_at)
    values(season,award,'CASH_PAYOUTS','WEEKLY_HIGH_SCORE_CASH',-5000,'Rollback cash fixture',now());
  insert into public.bet_proposals(season_id,weekly_decision_id,submitted_by,category,sport,proposed_stake_cents,status)
    values(season,decision,member,'WEEKLY','NFL',5000,'AWAITING_COMMISSIONER_PLACEMENT') returning id into proposal;
  update public.weekly_sync_state set last_attempt_at=null where season_id=season;
  r:=public.begin_weekly_sync(season);lease:=(r->>'lease_id')::uuid;
  r:=public.finish_weekly_sync(season,lease,repeat('d',64),payload);
  if r->>'reason'<>'result_changed_after_decision' or (select fantasy_team_id from public.weekly_awards where id=award)<>'12'
    or (select identified_at from public.weekly_awards where id=award)<>initial_time
    or (select count(*) from public.ledger_transactions where season_id=season)<>1
    then raise exception 'locked_choice_changed'; end if;
  begin perform public.record_ticket_placement(actor,season,proposal,100);raise exception 'expected_review_block';
    exception when others then if sqlerrm<>'weekly_award_review_required' then raise; end if; end;
  -- A later matching result cannot silently clear a flagged correction.
  update public.weekly_sync_state set last_attempt_at=null where season_id=season;
  r:=public.begin_weekly_sync(season);lease:=(r->>'lease_id')::uuid;
  r:=public.finish_weekly_sync(season,lease,repeat('a',64),original_payload);
  if not (select requires_commissioner_resolution from public.weekly_awards where id=award) then raise exception 'review_silently_cleared'; end if;
  if not exists(select 1 from public.weekly_awards where season_id=season and week=1
    and award_basis='PREVIOUS_CHAMPION' and fantasy_team_id='13' and score is null)
    then raise exception 'champion_overwritten'; end if;
  -- Incomplete and stale periods never replace the award.
  update public.weekly_sync_state set last_attempt_at=null where season_id=season;
  r:=public.begin_weekly_sync(season);lease:=(r->>'lease_id')::uuid;
  r:=public.finish_weekly_sync(season,lease,repeat('a',64),jsonb_set(original_payload,'{completed_weeks}','[]'));
  if r->>'skipped'<>'scores_not_finalized' then raise exception 'incomplete_week_accepted'; end if;
  perform set_config('du_test.now','2026-09-22 13:05Z',true);
  r:=public.begin_weekly_sync(season);lease:=(r->>'lease_id')::uuid;
  begin perform public.finish_weekly_sync(season,lease,repeat('a',64),original_payload);raise exception 'expected_stale_week';
    exception when others then if sqlerrm<>'unexpected_scoring_week' then raise; end if; end;
  perform set_config('du_test.now','2026-12-22 14:05Z',true);
  if public.begin_weekly_sync(season)->>'skipped'<>'weekly_award_program_complete' then raise exception 'week14_cap_failed'; end if;
  if has_function_privilege('anon','public.begin_weekly_sync(uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.finish_weekly_sync(uuid,uuid,text,jsonb)','EXECUTE')
    or has_table_privilege('authenticated','public.weekly_sync_state','UPDATE') then raise exception 'browser_sync_access'; end if;
  reset role;
end $$;
