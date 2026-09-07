alter table public.analysis_policy drop constraint analysis_policy_cooldown_seconds_check;
alter table public.analysis_policy alter column cooldown_seconds set default 0;
update public.analysis_policy set cooldown_seconds=0;
alter table public.analysis_policy add constraint analysis_policy_cooldown_seconds_check check(cooldown_seconds=0);
do $$
begin
  execute replace(pg_get_functiondef('public.reserve_weekly_analysis(uuid)'::regprocedure),
    'if last_run is not null and last_run+make_interval(secs=>p.cooldown_seconds)>t then raise exception ''analysis_cooldown''; end if;', 'null; -- Cache freshness replaces the run cooldown.');
  execute replace(pg_get_functiondef('public.finish_provider_request(uuid,integer,jsonb)'::regprocedure),
    'interval ''60 seconds''','interval ''180 seconds''');
end $$;
