-- Rollback fixture: no outbound requests or persisted league changes.
do $$ declare s uuid:=gen_random_uuid(); l uuid:=gen_random_uuid(); b uuid; r jsonb; begin
 execute replace(pg_get_functiondef('public.claim_futures_refresh()'::regprocedure),'''DU Shamers''','''Futures fixture''');
 insert into public.leagues(id,name) values(l,'Futures fixture');
 insert into public.seasons(id,league_id,year) values(s,l,2026);
 insert into public.bets(season_id,category,stake_cents,placed_american_odds,potential_return_cents,placed_at) values(s,'FUTURE',10000,1900,200000,now()) returning id into b;
 insert into public.futures_feed_mapping values(b,'test-sport','test-event','Test');
 insert into public.league_standings_snapshots(season_id,source_hash,payload,observed_at) values(s,repeat('a',64),'{"completed_weeks":[{"week":1}]}',now());
 update public.futures_feed_policy set enabled=true;
 r:=public.claim_futures_refresh();
 if r->>'run_id' is null or (r->>'week')::integer<>1 then raise exception 'week claim failed'; end if;
 if public.claim_futures_refresh()->>'skipped'<>'day_attempted' then raise exception 'duplicate run accepted'; end if;
 update public.futures_feed_runs set success=true where id=(r->>'run_id')::uuid;
 if public.claim_futures_refresh()->>'skipped'<>'day_attempted' then raise exception 'saved day refreshed'; end if;
 update public.futures_feed_runs set success=false,started_at=now()-interval '2 days' where id=(r->>'run_id')::uuid;
 update public.futures_feed_policy set monthly_request_limit=0;
 if public.claim_futures_refresh()->>'skipped'<>'monthly_cap' then raise exception 'cap bypassed'; end if;
 update public.futures_feed_policy set monthly_request_limit=30;
 update public.bets set status='LOST' where id=b;
 if public.claim_futures_refresh()->>'skipped'<>'no_supported_open_positions' then raise exception 'settled position refreshed'; end if;
 if has_function_privilege('anon','public.claim_futures_refresh()','execute') or has_function_privilege('authenticated','private.futures_feed_key()','execute') then raise exception 'public job or key access'; end if;
end $$;
