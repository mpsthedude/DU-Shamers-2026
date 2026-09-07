create table public.provider_budget (
  provider text primary key check(provider='sportsgameodds'),
  enabled boolean not null default false,
  daily_request_limit integer not null default 0 check(daily_request_limit between 0 and 100000),
  monthly_request_limit integer not null default 0 check(monthly_request_limit between 0 and 1000000),
  daily_budget_microusd bigint not null default 0 check(daily_budget_microusd>=0),
  monthly_budget_microusd bigint not null default 0 check(monthly_budget_microusd>=0),
  max_request_cost_microusd bigint not null default 0 check(max_request_cost_microusd>=0),
  per_user_daily_limit integer not null default 0 check(per_user_daily_limit between 0 and 10000),
  max_concurrent integer not null default 2 check(max_concurrent between 1 and 4),
  updated_at timestamptz not null default now()
);
insert into public.provider_budget(provider) values('sportsgameodds');
create table public.provider_requests (
  id uuid primary key default gen_random_uuid(),
  provider text not null references public.provider_budget(provider),
  cache_key text not null,
  actor uuid references public.profiles(id),
  reserved_microusd bigint not null check(reserved_microusd>=0),
  actual_microusd bigint,
  status text not null default 'RESERVED' check(status in ('RESERVED','COMPLETE','FAILED','UNKNOWN')),
  created_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz not null,
  completed_at timestamptz,
  http_status integer
);
create unique index provider_one_inflight_key on public.provider_requests(provider,cache_key) where status='RESERVED';
create index provider_requests_time on public.provider_requests(provider,created_at);
create index provider_requests_actor_time on public.provider_requests(actor,created_at);
create table public.provider_cache (
  provider text not null references public.provider_budget(provider),
  cache_key text not null,
  payload jsonb not null,
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  primary key(provider,cache_key)
);
alter table public.provider_budget enable row level security;
alter table public.provider_requests enable row level security;
alter table public.provider_cache enable row level security;
revoke all on public.provider_budget,public.provider_requests,public.provider_cache from anon,authenticated;
grant select,update on public.provider_budget to service_role;
grant select,insert,update on public.provider_requests,public.provider_cache to service_role;

create function public.reserve_provider_request(p_key text,p_actor uuid default null,p_allow_member boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  b public.provider_budget%rowtype; c public.provider_cache%rowtype;
  t timestamptz; day_start timestamptz; month_start timestamptz;
  day_count bigint; month_count bigint; day_cost numeric; month_cost numeric;
  user_count bigint; r uuid;
begin
  if p_key is null or p_key!~'^[0-9a-f]{64}$' then raise exception 'invalid_cache_key'; end if;
  select * into b from public.provider_budget where provider='sportsgameodds' for update;
  if not found then raise exception 'paid_requests_disabled'; end if;
  t:=clock_timestamp();
  select * into c from public.provider_cache where provider=b.provider and cache_key=p_key and expires_at>t;
  if found then return jsonb_build_object('cached',true,'payload',c.payload,'observed_at',c.observed_at); end if;
  if not b.enabled then raise exception 'paid_requests_disabled'; end if;
  -- Email allowlist is checked by Edge auth before passing a commissioner actor.
  if p_actor is null or not exists(select 1 from public.league_members m join public.leagues l on l.id=m.league_id
    where m.profile_id=p_actor and l.name='DU Shamers' and (m.role='COMMISSIONER' or (p_allow_member and m.fantasy_team_id is not null)))
    then raise exception 'fresh_provider_request_not_authorized'; end if;
  update public.provider_requests set status='UNKNOWN' where provider=b.provider and status='RESERVED' and lease_until<=t;
  if exists(select 1 from public.provider_requests where provider=b.provider and cache_key=p_key and status='RESERVED')
    then raise exception 'provider_refresh_in_progress'; end if;
  if (select count(*) from public.provider_requests where provider=b.provider and status='RESERVED')>=b.max_concurrent
    then raise exception 'provider_concurrency_limit'; end if;
  day_start:=date_trunc('day',t at time zone 'UTC') at time zone 'UTC';
  month_start:=date_trunc('month',t at time zone 'UTC') at time zone 'UTC';
  select count(*),coalesce(sum(reserved_microusd),0),
    count(*) filter(where created_at>=day_start),coalesce(sum(reserved_microusd) filter(where created_at>=day_start),0),
    count(*) filter(where actor=p_actor and created_at>=day_start)
    into month_count,month_cost,day_count,day_cost,user_count
    from public.provider_requests where provider=b.provider and created_at>=month_start;
  if b.max_request_cost_microusd<=0 or day_count>=b.daily_request_limit or month_count>=b.monthly_request_limit
    or day_cost+b.max_request_cost_microusd>b.daily_budget_microusd
    or month_cost+b.max_request_cost_microusd>b.monthly_budget_microusd
    then raise exception 'provider_budget_exhausted'; end if;
  if user_count>=b.per_user_daily_limit then raise exception 'provider_user_quota_exhausted'; end if;
  insert into public.provider_requests(provider,cache_key,actor,reserved_microusd,lease_until)
    values(b.provider,p_key,p_actor,b.max_request_cost_microusd,t+interval '2 minutes') returning id into r;
  return jsonb_build_object('cached',false,'reservation_id',r);
end $$;

create function public.finish_provider_request(p_id uuid,p_status integer,p_payload jsonb default null)
returns void language plpgsql security invoker set search_path='' as $$
declare r public.provider_requests%rowtype; t timestamptz:=clock_timestamp();
begin
  select * into r from public.provider_requests where id=p_id for update;
  if not found then raise exception 'reservation_not_found'; end if;
  if r.status<>'RESERVED' then return; end if;
  -- Never refund ambiguous/failed calls; retain full reserved cost until audited.
  update public.provider_requests set status=case when p_status=200 and p_payload is not null then 'COMPLETE' else 'FAILED' end,
    completed_at=t,http_status=p_status where id=p_id;
  if p_status=200 and p_payload is not null and r.lease_until>t then
    if pg_column_size(p_payload)>4000000 then raise exception 'provider_payload_too_large'; end if;
    insert into public.provider_cache(provider,cache_key,payload,observed_at,expires_at)
      values(r.provider,r.cache_key,p_payload,t,t+interval '60 seconds')
      on conflict(provider,cache_key) do update set payload=excluded.payload,observed_at=excluded.observed_at,expires_at=excluded.expires_at;
  end if;
end $$;
revoke all on function public.reserve_provider_request(text,uuid,boolean) from public,anon,authenticated;
revoke all on function public.finish_provider_request(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_provider_request(text,uuid,boolean) to service_role;
grant execute on function public.finish_provider_request(uuid,integer,jsonb) to service_role;

create function public.provider_budget_status() returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('policy',to_jsonb(b),
    'day_requests',count(r.id) filter(where r.created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
    'month_requests',count(r.id),
    'day_reserved_microusd',coalesce(sum(r.reserved_microusd) filter(where r.created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0),
    'month_reserved_microusd',coalesce(sum(r.reserved_microusd),0),
    'unreconciled_requests',count(r.id) filter(where r.status in ('UNKNOWN','RESERVED')))
  from public.provider_budget b left join public.provider_requests r on r.provider=b.provider
    and r.created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'
  where b.provider='sportsgameodds' group by b.provider;
$$;
revoke all on function public.provider_budget_status() from public,anon,authenticated;
grant execute on function public.provider_budget_status() to service_role;
