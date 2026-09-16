-- Server-controlled identity routing; clients cannot select another league.
create table public.builder_test_accounts(profile_id uuid primary key references public.profiles(id));
alter table public.builder_test_accounts enable row level security;
revoke all on public.builder_test_accounts from anon,authenticated;
grant select on public.builder_test_accounts to service_role;
create function public.actor_league_name(p_actor uuid) returns text language sql stable security invoker set search_path='' as $$
 select case when exists(select 1 from public.builder_test_accounts where profile_id=p_actor) then 'DU Shamers Test' else 'DU Shamers' end;
$$;
revoke all on function public.actor_league_name(uuid) from public,anon,authenticated;
grant execute on function public.actor_league_name(uuid) to service_role;
do $$ declare fn text; original text; amended text;
begin
 foreach fn in array array['public.reserve_weekly_analysis(uuid)','public.reserve_provider_request(text,uuid,boolean)'] loop
  original:=pg_get_functiondef(fn::regprocedure);
  amended:=replace(original,'l.name=''DU Shamers''','l.name=public.actor_league_name(p_actor)');
  if amended=original then raise exception 'Expected league guard missing: %',fn;end if;
  execute amended;
 end loop;
end $$;
