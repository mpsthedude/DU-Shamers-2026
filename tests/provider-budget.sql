-- BEGIN/ROLLBACK ONLY. Uses fixture identities and fabricated provider responses, never network calls.
do $$
declare actor uuid:=gen_random_uuid(); league uuid; r jsonb; first_id uuid; second_id uuid; k text:=repeat('a',64); totals jsonb;
begin
  select id into league from public.leagues where name='DU Shamers';
  insert into auth.users(id,email) values(actor,actor::text||'@example.invalid');
  insert into public.league_members(league_id,profile_id,role) values(league,actor,'COMMISSIONER');
  set local role service_role;
  begin perform public.reserve_provider_request(k,actor); raise exception 'expected_disabled';
  exception when others then if sqlerrm<>'paid_requests_disabled' then raise; end if; end;
  update public.provider_budget set enabled=true,daily_request_limit=2,monthly_request_limit=2,
    daily_budget_microusd=200,monthly_budget_microusd=200,max_request_cost_microusd=100,per_user_daily_limit=2,max_concurrent=1;
  begin perform public.reserve_provider_request(k,null); raise exception 'expected_auth';
  exception when others then if sqlerrm<>'fresh_provider_request_not_authorized' then raise; end if; end;
  r:=public.reserve_provider_request(k,actor);first_id:=(r->>'reservation_id')::uuid;
  begin perform public.reserve_provider_request(k,actor);raise exception 'expected_duplicate';
  exception when others then if sqlerrm<>'provider_refresh_in_progress' then raise; end if; end;
  begin perform public.reserve_provider_request(repeat('b',64),actor);raise exception 'expected_concurrency_limit';
  exception when others then if sqlerrm<>'provider_concurrency_limit' then raise; end if; end;
  perform public.finish_provider_request(first_id,200,'{"success":true,"data":[]}');
  update public.provider_budget set enabled=false;
  r:=public.reserve_provider_request(k,null);
  if r->>'cached'<>'true' then raise exception 'public_cache_unavailable'; end if;
  update public.provider_budget set enabled=true;
  r:=public.reserve_provider_request(repeat('b',64),actor);second_id:=(r->>'reservation_id')::uuid;
  perform public.finish_provider_request(second_id,0,null);
  perform public.finish_provider_request(second_id,200,'{"data":[]}');
  if exists(select 1 from public.provider_cache where cache_key=repeat('b',64)) then raise exception 'failed_call_cached'; end if;
  begin perform public.reserve_provider_request(repeat('c',64),actor);raise exception 'expected_budget_limit';
  exception when others then if sqlerrm<>'provider_budget_exhausted' then raise; end if; end;
  totals:=public.provider_budget_status();
  if (totals->>'day_requests')::integer<>2 or (totals->>'day_reserved_microusd')::integer<>200 then raise exception 'failed_call_refunded'; end if;
  update public.provider_budget set daily_request_limit=10,monthly_request_limit=10,daily_budget_microusd=1000,monthly_budget_microusd=1000,per_user_daily_limit=2;
  begin perform public.reserve_provider_request(repeat('c',64),actor);raise exception 'expected_user_limit';
  exception when others then if sqlerrm<>'provider_user_quota_exhausted' then raise; end if; end;
  update public.provider_budget set per_user_daily_limit=10,monthly_budget_microusd=200;
  begin perform public.reserve_provider_request(repeat('c',64),actor);raise exception 'expected_month_money_limit';
  exception when others then if sqlerrm<>'provider_budget_exhausted' then raise; end if; end;
  update public.provider_budget set monthly_budget_microusd=1000,daily_budget_microusd=200;
  begin perform public.reserve_provider_request(repeat('c',64),actor);raise exception 'expected_day_money_limit';
  exception when others then if sqlerrm<>'provider_budget_exhausted' then raise; end if; end;
  update public.provider_budget set daily_budget_microusd=1000;
  r:=public.reserve_provider_request(repeat('c',64),actor);first_id:=(r->>'reservation_id')::uuid;
  update public.provider_requests set lease_until=now()-interval '1 minute' where id=first_id;
  r:=public.reserve_provider_request(repeat('d',64),actor);
  if (select status from public.provider_requests where id=first_id)<>'UNKNOWN' then raise exception 'expired_lease_not_retained'; end if;
  if (select sum(reserved_microusd) from public.provider_requests)<>400 then raise exception 'unknown_reservation_refunded'; end if;
  if has_function_privilege('anon','public.reserve_provider_request(text,uuid,boolean)','EXECUTE')
    or has_table_privilege('authenticated','public.provider_budget','UPDATE') then raise exception 'browser_budget_access'; end if;
  reset role;
end $$;
