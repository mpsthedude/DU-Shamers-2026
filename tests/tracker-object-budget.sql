-- Run inside BEGIN/ROLLBACK after the migration. No provider calls.
update public.integration_budget set enabled=true,daily_microusd=100000000,monthly_microusd=100000000 where singleton;
do $$ declare rid uuid; begin
 begin
 insert into public.provider_requests(provider,cache_key,reserved_microusd,lease_until) values('sportsgameodds',repeat('a',64),1,now()+interval '2 minutes');
 raise exception 'expected stale-usage denial'; exception when others then if sqlerrm<>'provider_usage_refresh_required' then raise; end if; end;
 update public.provider_object_policy set monthly_limit=40,reported_limit=100000,reported_used=0,reported_at=clock_timestamp() where singleton;
 insert into public.provider_requests(provider,cache_key,reserved_microusd,lease_until) values('sportsgameodds',repeat('b',64),1,now()+interval '2 minutes') returning id into rid;
 begin
 insert into public.provider_requests(provider,cache_key,reserved_microusd,lease_until) values('sportsgameodds',repeat('c',64),1,now()+interval '2 minutes');
 raise exception 'expected object denial'; exception when others then if sqlerrm<>'provider_object_budget_exhausted' then raise; end if; end;
 perform public.finish_provider_request(rid,200,'{"data":[{"eventID":"test"}]}'::jsonb);
 if (select returned_objects from public.provider_requests where id=rid)<>1 then raise exception 'returned object mismatch'; end if;
 update public.provider_object_policy set monthly_limit=80 where singleton;
 insert into public.provider_requests(provider,cache_key,reserved_microusd,lease_until) values('sportsgameodds',repeat('d',64),1,now()+interval '2 minutes') returning id into rid;
 perform public.finish_provider_request(rid,500,null);
 if (select returned_objects from public.provider_requests where id=rid) is not null then raise exception 'failed request refunded'; end if;
 if (public.claim_tracker_refresh()->>'skipped')<>'paused' then raise exception 'tracker not paused'; end if;
 if has_function_privilege('anon','public.claim_tracker_refresh()','execute') or has_table_privilege('authenticated','public.tracker_events','select') then raise exception 'browser privilege leak'; end if;
end $$;
