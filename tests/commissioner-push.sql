begin;
set local role service_role;
do $$
declare actor uuid; league uuid; season uuid; proposal uuid; n integer; test_endpoint text:='https://web.push.apple.com/test-rollback-only';
begin
 select m.profile_id,m.league_id into actor,league from public.league_members m where role='COMMISSIONER' limit 1;
 select id into season from public.seasons where league_id=league and year=2026;
 perform public.manage_push_subscription(actor,league,'enable',test_endpoint,'test','test');
 perform public.manage_push_subscription(actor,league,'enable',test_endpoint,'test','test');
 insert into public.bet_proposals(season_id,category,sport,proposed_stake_cents,status) values(season,'WEEKLY','NFL',10000,'AWAITING_COMMISSIONER_PLACEMENT') returning id into proposal;
 select count(*) into n from public.push_deliveries where proposal_id=proposal;
 if n<>1 then raise exception 'expected exactly one submission alert, got %',n;end if;
 insert into public.push_deliveries(subscription_id,proposal_id) select id,proposal from public.push_subscriptions where endpoint=test_endpoint and profile_id=actor on conflict do nothing;
 select count(*) into n from public.push_deliveries where proposal_id=proposal;
 if n<>1 then raise exception 'duplicate alert';end if;
 perform public.claim_push_deliveries();
 if not exists(select 1 from public.push_deliveries where proposal_id=proposal and attempts=1 and state='SENDING') then raise exception 'claim failed';end if;
 perform public.claim_push_deliveries();
 if exists(select 1 from public.push_deliveries where proposal_id=proposal and attempts<>1) then raise exception 'lease replayed';end if;
 perform public.manage_push_subscription(actor,league,'test',test_endpoint);
 begin
  perform public.manage_push_subscription(actor,league,'test',test_endpoint);
  raise exception 'cooldown not enforced';
 exception when others then if sqlerrm<>'test_cooldown' then raise;end if;end;
 begin
  perform public.manage_push_subscription(gen_random_uuid(),league,'enable',test_endpoint,'test','test');
  raise exception 'authorization not enforced';
 exception when others then if sqlerrm<>'commissioner_not_authorized' then raise;end if;end;
 perform public.manage_push_subscription(actor,league,'disable',test_endpoint);
 if exists(select 1 from public.push_deliveries where proposal_id=proposal) then raise exception 'disable did not cancel queued alerts';end if;
end $$;
reset role;
do $$begin
 if has_table_privilege('anon','public.push_config','SELECT') or has_table_privilege('authenticated','public.push_subscriptions','SELECT') or has_function_privilege('authenticated','public.claim_push_deliveries()','EXECUTE') then raise exception 'push permissions exposed';end if;
end $$;
rollback;

