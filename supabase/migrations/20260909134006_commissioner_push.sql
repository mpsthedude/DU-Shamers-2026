create table public.push_config(singleton boolean primary key default true check(singleton), public_key text not null, private_key text not null);
create table public.push_subscriptions(
 id uuid primary key default gen_random_uuid(),profile_id uuid not null references public.profiles(id),
 league_id uuid not null references public.leagues(id), endpoint text not null unique,
 p256dh text not null, auth_key text not null, created_at timestamptz not null default now()
);
create table public.push_deliveries(
 id uuid primary key default gen_random_uuid(),subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 proposal_id uuid references public.bet_proposals(id), created_at timestamptz not null default now(),
 state text not null default 'QUEUED' check(state in ('QUEUED','SENDING','SENT','FAILED','SKIPPED')),
 attempts integer not null default 0 check(attempts between 0 and 3), attempted_at timestamptz, error text,
 unique(subscription_id,proposal_id)
);
create index push_delivery_pending on public.push_deliveries(state,created_at);
alter table public.push_config enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;
revoke all on public.push_config,public.push_subscriptions,public.push_deliveries from anon,authenticated;
grant select,insert on public.push_config to service_role;
grant select,insert,update,delete on public.push_subscriptions,public.push_deliveries to service_role;

create function public.enqueue_commissioner_push() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.category='WEEKLY' and new.status='AWAITING_COMMISSIONER_PLACEMENT' then
  insert into public.push_deliveries(subscription_id,proposal_id)
  select ps.id,new.id from public.push_subscriptions ps join public.seasons s on s.league_id=ps.league_id
  join public.league_members m on m.profile_id=ps.profile_id and m.league_id=ps.league_id and m.role='COMMISSIONER'
  where s.id=new.season_id on conflict do nothing;
 end if; return new;
end $$;
revoke all on function public.enqueue_commissioner_push() from public,anon,authenticated;
create trigger enqueue_commissioner_push after insert on public.bet_proposals for each row execute function public.enqueue_commissioner_push();

create function public.manage_push_subscription(p_actor uuid,p_league uuid,p_action text,p_endpoint text,p_key text default null,p_auth text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare n integer; sub public.push_subscriptions%rowtype;
begin
 perform 1 from public.league_members where profile_id=p_actor and league_id=p_league and role='COMMISSIONER' for update;
 if not found then raise exception 'commissioner_not_authorized'; end if;
 select * into sub from public.push_subscriptions where endpoint=p_endpoint;
 if sub.id is not null and (sub.profile_id<>p_actor or sub.league_id<>p_league) then raise exception 'subscription_conflict'; end if;
 if p_action='disable' then delete from public.push_subscriptions where id=sub.id;return jsonb_build_object('ok',true);end if;
 if p_action='enable' then
  if sub.id is null and (select count(*) from public.push_subscriptions where profile_id=p_actor)>=5 then raise exception 'device_limit';end if;
  insert into public.push_subscriptions(profile_id,league_id,endpoint,p256dh,auth_key) values(p_actor,p_league,p_endpoint,p_key,p_auth)
  on conflict(endpoint) do update set p256dh=excluded.p256dh,auth_key=excluded.auth_key;
  return jsonb_build_object('ok',true);
 end if;
 if p_action='test' then
  if sub.id is null then raise exception 'device_not_enabled';end if;
  if exists(select 1 from public.push_deliveries d join public.push_subscriptions ps on ps.id=d.subscription_id where ps.profile_id=p_actor and d.proposal_id is null and d.created_at>now()-interval '1 minute') then raise exception 'test_cooldown';end if;
  insert into public.push_deliveries(subscription_id) values(sub.id);return jsonb_build_object('ok',true);
 end if;
 raise exception 'invalid_action';
end $$;
revoke all on function public.manage_push_subscription(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.manage_push_subscription(uuid,uuid,text,text,text,text) to service_role;

create function public.claim_push_deliveries() returns setof public.push_deliveries language sql security invoker set search_path='' as $$
 update public.push_deliveries d set state='SENDING',attempts=d.attempts+1,attempted_at=now()
 where id in (select id from public.push_deliveries where attempts<3 and created_at>now()-interval '1 day'
 and (state='QUEUED' or (state='SENDING' and attempted_at<now()-interval '5 minutes'))
 order by created_at for update skip locked limit 5) returning d.*;
$$;
revoke all on function public.claim_push_deliveries() from public,anon,authenticated;
grant execute on function public.claim_push_deliveries() to service_role;
select cron.schedule('du-shamers-commissioner-push','* * * * *',$job$
 select net.http_post(url:='https://xvnkwtiydyrksucgiphi.supabase.co/functions/v1/commissioner-push',headers:='{"Content-Type":"application/json"}'::jsonb,body:='{"scheduled":true}'::jsonb,timeout_milliseconds:=10000)
 where exists(select 1 from public.push_deliveries where attempts<3 and created_at>now()-interval '1 day' and (state='QUEUED' or (state='SENDING' and attempted_at<now()-interval '5 minutes')));
$job$);
