-- Run ONLY in a transaction and always roll back. Fixtures never persist.
-- The migration must be installed (or prepended inside the same transaction).
create function pg_temp.reject_test_ledger() returns trigger language plpgsql as $$
begin
  if current_setting('du_shamers.test_fail_ledger', true) = 'on' then
    raise exception 'test_ledger_failure';
  end if;
  return new;
end;
$$;
create trigger accounting_test_failure before insert on public.ledger_transactions
  for each row execute function pg_temp.reject_test_ledger();

do $$
declare
  actor uuid := gen_random_uuid();
  league uuid := gen_random_uuid();
  season uuid := gen_random_uuid();
  proposal uuid;
  bet uuid;
  result jsonb;
  n integer;
  total bigint;
  outcome text;
begin
  insert into auth.users (id,email) values (actor, actor::text || '@example.invalid');
  insert into public.leagues (id,name) values (league,'Rollback accounting fixture');
  insert into public.seasons (id,league_id,year) values (season,league,2026);
  insert into public.league_members (league_id,profile_id,role) values (league,actor,'COMMISSIONER');

  foreach outcome in array array['WON','LOST','PUSHED','VOID'] loop
    insert into public.bet_proposals (season_id,category,sport,proposed_stake_cents,status)
      values (season,'WEEKLY','NFL',5000,'AWAITING_COMMISSIONER_PLACEMENT') returning id into proposal;
    insert into public.bet_proposal_legs (proposal_id,sport,event_id,odd_id,event_name,
      market_name,selection,american_odds,event_start_at,observed_at)
      values (proposal,'NFL','fixture-event','fixture-odd','Fixture game','Moneyline',
        'Fixture selection',150,now()+interval '1 day',now());

    perform set_config('du_shamers.test_fail_ledger','on',true);
    begin
      perform public.record_ticket_placement(actor,season,proposal,150,'fixture');
      raise exception 'expected_placement_failure';
    exception when others then
      if sqlerrm <> 'test_ledger_failure' then raise; end if;
    end;
    if exists(select 1 from public.bets where proposal_id=proposal) then
      raise exception 'partial_placement_persisted';
    end if;
    if (select status from public.bet_proposals where id=proposal) <> 'AWAITING_COMMISSIONER_PLACEMENT' then
      raise exception 'proposal_changed_on_failure';
    end if;
    perform set_config('du_shamers.test_fail_ledger','off',true);
    result := public.record_ticket_placement(actor,season,proposal,150,'fixture');
    bet := (result->'bet'->>'id')::uuid;
    if (result->'bet'->>'potential_return_cents')::integer <> 12500 then raise exception 'wrong_payout'; end if;
    result := public.record_ticket_placement(actor,season,proposal,150,'fixture');
    if result->>'replayed' <> 'true' then raise exception 'placement_not_idempotent'; end if;
    select count(*) into n from public.ledger_transactions where bet_id=bet and transaction_type='BET_PLACED';
    if n <> 1 then raise exception 'duplicate_placement'; end if;
    begin
      perform public.record_ticket_placement(actor,season,proposal,200,'fixture');
      raise exception 'expected_placement_conflict';
    exception when others then if sqlerrm <> 'placement_conflict' then raise; end if; end;

    if outcome <> 'LOST' then
      perform set_config('du_shamers.test_fail_ledger','on',true);
      begin
        perform public.record_ticket_settlement(actor,season,bet,outcome,case when outcome='WON' then 12500 else null end);
        raise exception 'expected_settlement_failure';
      exception when others then if sqlerrm <> 'test_ledger_failure' then raise; end if; end;
      if (select status from public.bets where id=bet) <> 'OPEN' then raise exception 'partial_settlement_persisted'; end if;
      perform set_config('du_shamers.test_fail_ledger','off',true);
    end if;
    result := public.record_ticket_settlement(actor,season,bet,outcome,case when outcome='WON' then 12500 else null end);
    result := public.record_ticket_settlement(actor,season,bet,outcome,case when outcome='WON' then 12500 else null end);
    if result->>'replayed' <> 'true' then raise exception 'settlement_not_idempotent'; end if;
    select count(*),coalesce(sum(amount_cents),0) into n,total from public.ledger_transactions
      where bet_id=bet and transaction_type='BET_SETTLEMENT_RETURN';
    if (outcome='LOST' and (n<>0 or total<>0)) or
      (outcome='WON' and (n<>1 or total<>12500)) or
      (outcome in ('PUSHED','VOID') and (n<>1 or total<>5000)) then raise exception 'incorrect_return'; end if;
    begin
      perform public.record_ticket_settlement(actor,season,bet,case when outcome='LOST' then 'WON' else 'LOST' end,10000);
      raise exception 'expected_conflict';
    exception when others then if sqlerrm not in ('settlement_conflict','invalid_settlement_return') then raise; end if; end;
  end loop;
  begin
    perform public.record_ticket_settlement(gen_random_uuid(),season,bet,'LOST',0);
    raise exception 'expected_authorization_failure';
  exception when others then if sqlerrm <> 'commissioner_not_authorized' then raise; end if; end;
  insert into public.bet_proposals (season_id,category,sport,proposed_stake_cents,status)
    values (season,'WEEKLY','NFL',200000,'AWAITING_COMMISSIONER_PLACEMENT') returning id into proposal;
  insert into public.bet_proposal_legs (proposal_id,sport,event_id,odd_id,event_name,
    market_name,selection,american_odds,event_start_at,observed_at)
    values (proposal,'NFL','fixture-event','fixture-odd','Fixture game','Moneyline',
      'Fixture selection',150,now()+interval '1 day',now());
  begin
    perform public.record_ticket_placement(actor,season,proposal,150);
    raise exception 'expected_allocation_failure';
  exception when others then if sqlerrm <> 'allocation_exceeded' then raise; end if; end;
  begin
    perform public.record_ticket_placement(actor,season,proposal,50);
    raise exception 'expected_odds_failure';
  exception when others then if sqlerrm <> 'invalid_american_odds' then raise; end if; end;
  if exists (select 1 from public.bets where proposal_id=proposal) then raise exception 'invalid_ticket_persisted'; end if;
  if has_function_privilege('anon','public.record_ticket_settlement(uuid,uuid,uuid,text,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.record_ticket_placement(uuid,uuid,uuid,integer,text,timestamptz)','EXECUTE') then
    raise exception 'browser_can_execute_accounting';
  end if;
end;
$$;
select 'placement, settlement, retries, conflicts, rollback, outcomes and browser restrictions passed' as test_result;
