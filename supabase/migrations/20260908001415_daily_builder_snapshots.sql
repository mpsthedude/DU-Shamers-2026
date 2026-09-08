create table public.builder_refresh_policy (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 last_slot timestamptz, last_attempt_at timestamptz, last_error text
);
insert into public.builder_refresh_policy default values;
create table public.builder_snapshots (
 league text primary key check(league in ('NFL','NCAAF')), payload jsonb not null, observed_at timestamptz not null
);
alter table public.builder_refresh_policy enable row level security;
alter table public.builder_snapshots enable row level security;
revoke all on public.builder_refresh_policy,public.builder_snapshots from anon,authenticated;
grant select,update on public.builder_refresh_policy to service_role;
grant select,insert,update on public.builder_snapshots to service_role;
create function public.claim_builder_refresh() returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.builder_refresh_policy%rowtype; actor uuid; slot timestamptz;
begin
 select * into p from public.builder_refresh_policy where singleton for update;
 if not p.enabled or not exists(select 1 from public.provider_budget where provider='sportsgameodds' and enabled) or not exists(select 1 from public.integration_budget where singleton and enabled) then return jsonb_build_object('skipped','paused'); end if;
 slot:=(date_trunc('day',(now() at time zone 'UTC')-interval '12 hours 15 minutes')+interval '12 hours 15 minutes') at time zone 'UTC';
 if p.last_slot>=slot then return jsonb_build_object('skipped','not_due'); end if;
 select m.profile_id into actor from public.league_members m join public.leagues l on l.id=m.league_id join auth.users u on u.id=m.profile_id join public.commissioner_allowlist c on c.league_id=l.id and c.email=lower(u.email)
 where l.name='DU Shamers' and m.role='COMMISSIONER' and u.email_confirmed_at is not null limit 1;
 if actor is null then return jsonb_build_object('skipped','commissioner_unavailable'); end if;
 update public.builder_refresh_policy set last_slot=slot,last_attempt_at=clock_timestamp(),last_error=null where singleton;
 return jsonb_build_object('actor',actor,'slot',slot);
end $$;
revoke all on function public.claim_builder_refresh() from public,anon,authenticated;
grant execute on function public.claim_builder_refresh() to service_role;
select cron.schedule('du-shamers-daily-builder','15 12 * * *',$job$
 select net.http_post(url:='https://xvnkwtiydyrksucgiphi.supabase.co/functions/v1/refresh-builder',
 headers:='{"Content-Type":"application/json","apikey":"sb_publishable_oTJVPjW_EdOokBZfTSJKaA_GuUwJjOF","Authorization":"Bearer sb_publishable_oTJVPjW_EdOokBZfTSJKaA_GuUwJjOF"}'::jsonb,
 body:='{"scheduled":true}'::jsonb,timeout_milliseconds:=20000)
 from public.builder_refresh_policy where singleton and enabled;
$job$);
