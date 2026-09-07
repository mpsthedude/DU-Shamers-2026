-- All controls start paused. Object reservations protect every existing events caller.
create table public.provider_object_policy (
 singleton boolean primary key default true check(singleton),
 monthly_limit integer not null default 0 check(monthly_limit between 0 and 100000),
 reported_used bigint not null default 0 check(reported_used>=0),
 reported_limit bigint not null default 0 check(reported_limit>=0),
 reported_at timestamptz
);
insert into public.provider_object_policy(singleton) values(true);
alter table public.provider_requests add column reserved_objects integer not null default 40 check(reserved_objects between 1 and 40), add column returned_objects integer check(returned_objects>=0);
alter table public.provider_object_policy enable row level security;
revoke all on public.provider_object_policy from anon,authenticated;
grant select,update on public.provider_object_policy to service_role;
create function public.enforce_object_budget() returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.provider_object_policy%rowtype; local_used bigint; account_pending bigint;
begin
 select * into p from public.provider_object_policy where singleton for update;
 if p.monthly_limit=0 or p.reported_at is null or p.reported_at<clock_timestamp()-interval '24 hours' then raise exception 'provider_usage_refresh_required'; end if;
 select coalesce(sum(coalesce(returned_objects,reserved_objects)) filter(where created_at>=date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC'),0),
 coalesce(sum(coalesce(returned_objects,reserved_objects)) filter(where created_at>=p.reported_at or status in ('RESERVED','UNKNOWN')),0)
 into local_used,account_pending from public.provider_requests where provider=new.provider;
 if local_used+new.reserved_objects>p.monthly_limit or p.reported_used+account_pending+new.reserved_objects>p.reported_limit then raise exception 'provider_object_budget_exhausted'; end if;
 if (select count(*) from public.provider_requests where created_at>clock_timestamp()-interval '1 minute')>=40 then raise exception 'provider_minute_limit'; end if;
 return new;
end $$;
create trigger provider_object_reservation before insert on public.provider_requests for each row execute function public.enforce_object_budget();
-- Preserve the deployed finishing logic and cache lifetime; account only validated arrays.
do $$ declare src text; begin
 src:=pg_get_functiondef('public.finish_provider_request(uuid,integer,jsonb)'::regprocedure);
 src:=replace(src,'completed_at=t,http_status=p_status where id=p_id;', 'completed_at=t,http_status=p_status,returned_objects=case when p_status=200 and jsonb_typeof(p_payload->''data'')=''array'' then jsonb_array_length(p_payload->''data'') else null end where id=p_id;');
 if src=pg_get_functiondef('public.finish_provider_request(uuid,integer,jsonb)'::regprocedure) then raise exception 'finish_patch_not_applied'; end if;
 execute src;
end $$;
create table public.tracker_policy (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 last_attempt_at timestamptz, lease_id uuid, lease_until timestamptz, last_error text
);
insert into public.tracker_policy(singleton) values(true);
create table public.tracker_events (
 event_id text primary key, observed_at timestamptz not null, terminal boolean not null default false, payload jsonb not null
);
alter table public.tracker_policy enable row level security;
alter table public.tracker_events enable row level security;
revoke all on public.tracker_policy,public.tracker_events from anon,authenticated;
grant select,update on public.tracker_policy to service_role;
grant select,insert,update on public.tracker_events to service_role;
create function public.claim_tracker_refresh() returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.tracker_policy%rowtype; a uuid; events jsonb; token uuid:=gen_random_uuid();
begin
 select * into p from public.tracker_policy where singleton for update;
 if not p.enabled then return jsonb_build_object('skipped','paused'); end if;
 if p.last_attempt_at>clock_timestamp()-interval '180 seconds' or p.lease_until>clock_timestamp() then return jsonb_build_object('skipped','not_due'); end if;
 select m.profile_id into a from public.league_members m join public.leagues l on l.id=m.league_id join auth.users u on u.id=m.profile_id join public.commissioner_allowlist c on c.league_id=l.id and c.email=lower(u.email)
 where l.name='DU Shamers' and m.role='COMMISSIONER' and u.email_confirmed_at is not null limit 1;
 if a is null then return jsonb_build_object('skipped','commissioner_unavailable'); end if;
 select jsonb_agg(x) into events from (select distinct leg.event_id from public.bets b join public.bet_proposal_legs leg on leg.proposal_id=b.proposal_id
 join public.seasons s on s.id=b.season_id join public.leagues l on l.id=s.league_id
 left join public.tracker_events e on e.event_id=leg.event_id
 where l.name='DU Shamers' and b.status='OPEN' and b.category='WEEKLY' and leg.provider='sportsgameodds' and leg.sport in ('NFL','NCAAF')
 and leg.event_start_at<=clock_timestamp()+interval '10 minutes' and leg.event_start_at>clock_timestamp()-interval '18 hours'
 and not coalesce(e.terminal,false) order by leg.event_id limit 40) x;
 if events is null then return jsonb_build_object('skipped','no_active_games'); end if;
 update public.tracker_policy set last_attempt_at=clock_timestamp(),lease_id=token,lease_until=clock_timestamp()+interval '2 minutes',last_error=null where singleton;
 return jsonb_build_object('lease_id',token,'actor',a,'events',events);
end $$;
create function public.tracker_ticket_data(p_season uuid) returns jsonb language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(x order by x.week desc),'[]'::jsonb) from (
 select b.id,b.status,b.stake_cents,b.placed_american_odds as odds,b.potential_return_cents,b.settlement_return_cents,a.week,a.fantasy_team_name as owner,
 (select coalesce(jsonb_agg(jsonb_build_object('event_id',g.event_id,'odd_id',g.odd_id,'event_name',g.event_name,'selection',g.selection,'target',g.line_value,'starts_at',g.event_start_at,'snapshot',e.payload,'observed_at',e.observed_at) order by g.sort_order),'[]'::jsonb)
 from public.bet_proposal_legs g left join public.tracker_events e on e.event_id=g.event_id where g.proposal_id=b.proposal_id) as legs
 from public.bets b join public.bet_proposals p on p.id=b.proposal_id join public.weekly_decisions d on d.id=p.weekly_decision_id join public.weekly_awards a on a.id=d.weekly_award_id
 where b.season_id=p_season and b.category='WEEKLY' and b.status in ('OPEN','WON','LOST','PUSHED','VOID')
 ) x;
$$;
revoke all on function public.enforce_object_budget(),public.claim_tracker_refresh(),public.tracker_ticket_data(uuid) from public,anon,authenticated;
grant execute on function public.claim_tracker_refresh(),public.tracker_ticket_data(uuid) to service_role;
alter table public.provider_object_policy add column usage_check_at timestamptz;
create function public.begin_usage_check() returns timestamptz language plpgsql security invoker set search_path='' as $$
declare p public.provider_object_policy%rowtype; t timestamptz:=clock_timestamp(); begin
 select * into p from public.provider_object_policy where singleton for update;
 if p.usage_check_at>t-interval '60 seconds' then raise exception 'usage_check_recent'; end if;
 update public.provider_object_policy set usage_check_at=t where singleton; return t;
end $$;
create function public.object_budget_status() returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('policy',to_jsonb(p),'local_month_objects',coalesce((select sum(coalesce(returned_objects,reserved_objects)) from public.provider_requests where created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),0)) from public.provider_object_policy p where singleton;
$$;
revoke all on function public.begin_usage_check(),public.object_budget_status() from public,anon,authenticated;
grant execute on function public.begin_usage_check(),public.object_budget_status() to service_role;
create extension if not exists pg_cron with schema pg_catalog;
-- This public key grants no job authority: enabled policy + DB lease + paid gate govern work.
select cron.schedule('du-shamers-weekly-tracker','* * * * *',$job$
 select net.http_post(
 url:='https://xvnkwtiydyrksucgiphi.supabase.co/functions/v1/refresh-weekly-tracker',
 headers:='{"Content-Type":"application/json","apikey":"sb_publishable_oTJVPjW_EdOokBZfTSJKaA_GuUwJjOF","Authorization":"Bearer sb_publishable_oTJVPjW_EdOokBZfTSJKaA_GuUwJjOF"}'::jsonb,
 body:='{"scheduled":true}'::jsonb,timeout_milliseconds:=20000)
 from public.tracker_policy where singleton and enabled;
$job$);
