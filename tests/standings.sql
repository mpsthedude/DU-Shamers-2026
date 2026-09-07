-- BEGIN/ROLLBACK ONLY. No ESPN network calls or real financial changes.
do $$
declare actor uuid:=gen_random_uuid(); league uuid:=gen_random_uuid(); season uuid:=gen_random_uuid();
 member uuid; award uuid:=gen_random_uuid(); proposal uuid; r jsonb; lease uuid; snapshot uuid; outcome text; payload jsonb;
begin
 insert into auth.users(id,email) values(actor,actor::text||'@example.invalid');
 insert into public.leagues(id,name) values(league,'Rollback standings fixture');
 insert into public.seasons(id,league_id,year) values(season,league,2026);
 insert into public.league_members(league_id,profile_id,role,fantasy_team_id) values(league,actor,'COMMISSIONER','3') returning id into member;
 insert into public.weekly_awards(id,season_id,week) values(award,season,1);
 insert into public.weekly_decisions(weekly_award_id,member_id,choice,cash_payout_cents,wager_budget_cents)
   values(award,member,'SPLIT_50_50',5000,5000);
 insert into public.ledger_transactions(season_id,weekly_award_id,account,transaction_type,amount_cents,description,occurred_at)
   values(season,award,'CASH_PAYOUTS','WEEKLY_HIGH_SCORE_CASH',-5000,'Rollback cash fixture',now());
 foreach outcome in array array['WON','LOST','PUSHED','VOID','OPEN'] loop
   insert into public.bet_proposals(season_id,submitted_by,category,sport,proposed_stake_cents,status)
     values(season,member,'WEEKLY','NFL',5000,'PLACED') returning id into proposal;
   insert into public.bets(season_id,proposal_id,category,stake_cents,placed_american_odds,potential_return_cents,status,placed_at,settlement_return_cents)
     values(season,proposal,'WEEKLY',5000,150,20000,outcome,now(),
       case outcome when 'WON' then 12500 when 'LOST' then 0 when 'OPEN' then null else 5000 end);
 end loop;
 insert into public.bets(season_id,category,stake_cents,placed_american_odds,potential_return_cents,status,placed_at,settlement_return_cents)
   values(season,'FUTURE',5000,100,10000,'WON',now(),10000);
 set local role service_role;
 select x into r from jsonb_array_elements(public.league_team_earnings(season)) x where x->>'team_id'='3';
 if (r->>'cash_allocated_cents')::int<>5000 or (r->>'gross_return_cents')::int<>22500
   or (r->>'net_contribution_cents')::int<>2500 or (r->>'open_potential_cents')::int<>20000 or (r->>'open_stake_cents')::int<>5000
   then raise exception 'incorrect_team_earnings'; end if;
 select x into r from jsonb_array_elements(public.league_team_earnings(season)) x where x->>'team_id' is null;
 if (r->>'gross_return_cents')::int<>10000 or (r->>'net_contribution_cents')::int<>5000 then raise exception 'unattributed_futures_lost'; end if;
 if public.league_team_earnings(gen_random_uuid())<>'[]'::jsonb then raise exception 'cross_season_earnings'; end if;
 begin perform public.begin_standings_refresh(season,null);raise exception 'expected_auth';
 exception when others then if sqlerrm<>'commissioner_not_authorized' then raise; end if; end;
 r:=public.begin_standings_refresh(season,actor);lease:=(r->>'lease_id')::uuid;
 begin perform public.begin_standings_refresh(season,actor);raise exception 'expected_inflight';
 exception when others then if sqlerrm<>'standings_refresh_in_progress' then raise; end if; end;
 payload:=jsonb_build_object('espn_league_id',290466,'year',2026,'teams',(select jsonb_agg(jsonb_build_object('team_id',i)) from generate_series(1,12) i));
 begin perform public.finish_standings_refresh(season,gen_random_uuid(),repeat('a',64),payload);raise exception 'expected_lease';
 exception when others then if sqlerrm<>'standings_refresh_expired' then raise; end if; end;
 snapshot:=public.finish_standings_refresh(season,lease,repeat('a',64),payload);
 if not exists(select 1 from public.league_standings_snapshots where id=snapshot) then raise exception 'snapshot_missing'; end if;
 r:=public.begin_standings_refresh(season,actor);
 if r->>'skipped'<>'standings_refresh_cooldown' then raise exception 'cooldown_missing'; end if;
 if has_table_privilege('anon','public.league_standings_snapshots','SELECT')
   or has_function_privilege('authenticated','public.league_team_earnings(uuid)','EXECUTE') then raise exception 'browser_direct_access'; end if;
 reset role;
end $$;
