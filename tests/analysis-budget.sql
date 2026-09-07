-- Execute only inside BEGIN / ROLLBACK. Temporary function replacement is rolled back.
do $$
declare actor uuid:=gen_random_uuid(); league uuid:=gen_random_uuid(); season uuid:=gen_random_uuid(); award uuid:=gen_random_uuid(); r jsonb; i integer;
begin
  execute replace(replace(pg_get_functiondef('public.reserve_weekly_analysis(uuid)'::regprocedure),
    '''DU Shamers''','''Analysis rollback fixture'''),'clock_timestamp()','''2026-09-15 14:00Z''::timestamptz');
  insert into auth.users(id,email) values(actor,actor::text||'@example.invalid');
  insert into public.leagues(id,name) values(league,'Analysis rollback fixture');
  insert into public.seasons(id,league_id,year) values(season,league,2026);
  insert into public.league_members(league_id,profile_id,fantasy_team_id,role) values(league,actor,'3','OWNER');
  insert into public.weekly_awards(id,season_id,week,fantasy_team_id,source_status,identified_at,source_observed_at)
    values(award,season,1,'3','WINNER_IDENTIFIED','2026-09-15 13:00Z','2026-09-15 13:00Z');
  begin perform public.reserve_weekly_analysis(actor);raise exception 'expected_disabled';
  exception when others then if sqlerrm<>'analysis_disabled' then raise;end if;end;
  update public.analysis_policy set enabled=true;
  begin perform public.reserve_weekly_analysis(gen_random_uuid());raise exception 'expected_winner_only';
  exception when others then if sqlerrm<>'analysis_winner_only' then raise;end if;end;
  for i in 1..5 loop
    r:=public.reserve_weekly_analysis(actor);
    if (r->>'remaining')::integer<>5-i then raise exception 'bad_remaining';end if;
  end loop;
  begin perform public.reserve_weekly_analysis(actor);raise exception 'expected_quota';
  exception when others then if sqlerrm<>'analysis_weekly_limit' then raise;end if;end;
  begin
    insert into public.provider_requests(provider,cache_key,reserved_microusd,lease_until) values('sportsgameodds',repeat('a',64),10,now()+interval '1 minute');
    raise exception 'expected_global_pause';
  exception when others then if sqlerrm<>'integrations_disabled' then raise;end if;end;
  update public.integration_budget set enabled=true,daily_microusd=10,monthly_microusd=10;
  insert into public.provider_requests(provider,cache_key,reserved_microusd,lease_until) values('sportsgameodds',repeat('a',64),10,now()+interval '1 minute');
  begin
    insert into public.provider_requests(provider,cache_key,reserved_microusd,lease_until) values('sportsgameodds',repeat('b',64),1,now()+interval '1 minute');
    raise exception 'expected_global_budget';
  exception when others then if sqlerrm<>'integration_budget_exhausted' then raise;end if;end;
  if has_function_privilege('authenticated','public.reserve_weekly_analysis(uuid)','EXECUTE') then raise exception 'browser_permission';end if;
end $$;
select 'disabled gates, winner eligibility, five immediate runs without cooldown, sixth-run denial, combined ceiling and browser restrictions passed' as result;
