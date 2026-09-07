-- Weekly, read-only DraftKings futures observations. No financial writes.
create table public.futures_feed_policy (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 monthly_request_limit integer not null default 30 check(monthly_request_limit between 0 and 30)
);
insert into public.futures_feed_policy default values;
create table public.futures_feed_mapping (
 bet_id uuid primary key references public.bets(id), sport_key text not null,
 event_id text not null, outcome_name text not null
);
create table public.futures_feed_runs (
 id uuid primary key default gen_random_uuid(), season_id uuid not null references public.seasons(id),
 week integer not null check(week between 0 and 18), started_at timestamptz not null default now(),
 finished_at timestamptz, success boolean not null default false,
 reserved_requests integer not null check(reserved_requests between 1 and 3), error text
);
create table public.futures_odds_history (
 bet_id uuid not null references public.bets(id), week integer not null check(week between 0 and 18),
 american_odds integer not null check(abs(american_odds::bigint) between 100 and 1000000),
 observed_at timestamptz not null, fetched_at timestamptz not null default now(),
 primary key(bet_id,week)
);
create index futures_feed_runs_season_week on public.futures_feed_runs(season_id,week);
alter table public.futures_feed_policy enable row level security;
alter table public.futures_feed_mapping enable row level security;
alter table public.futures_feed_runs enable row level security;
alter table public.futures_odds_history enable row level security;
revoke all on public.futures_feed_policy,public.futures_feed_mapping,public.futures_feed_runs,public.futures_odds_history from anon,authenticated;
grant select on public.futures_feed_policy,public.futures_feed_mapping to service_role;
grant select,insert,update on public.futures_feed_runs,public.futures_odds_history to service_role;
grant update on public.futures_feed_policy to service_role;

-- A narrow Vault accessor avoids granting the worker access to all Vault secrets.
create schema if not exists private;
create function private.futures_feed_key() returns text language sql security definer set search_path='' as $$
 select decrypted_secret from vault.decrypted_secrets where name='du_shamers_futures_odds_key';
$$;
revoke all on function private.futures_feed_key() from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.futures_feed_key() to service_role;

create function public.claim_futures_refresh() returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.futures_feed_policy%rowtype; s uuid; w integer; snapshot jsonb; observed timestamptz;
 maps jsonb; requests integer; run_id uuid; key text;
begin
 select * into p from public.futures_feed_policy where singleton for update;
 if not p.enabled then return jsonb_build_object('skipped','paused'); end if;
 select se.id into s from public.seasons se join public.leagues l on l.id=se.league_id where se.year=2026 and l.name='DU Shamers';
 if s is null or now()>timestamptz '2027-03-01 00:00:00+00' then return jsonb_build_object('skipped','season_closed'); end if;
 select payload,observed_at into snapshot,observed from public.league_standings_snapshots where season_id=s order by observed_at desc limit 1;
 select coalesce(max((v->>'week')::integer),0) into w from jsonb_array_elements(coalesce(snapshot->'completed_weeks','[]'::jsonb)) v where (v->>'week')::integer between 1 and 18;
 if w>0 and observed<now()-interval '36 hours' then return jsonb_build_object('skipped','awaiting_fresh_week_confirmation'); end if;
 if exists(select 1 from public.futures_feed_runs where season_id=s and week=w and success) then return jsonb_build_object('skipped','week_saved'); end if;
 if (select count(*) from public.futures_feed_runs where season_id=s and week=w)>=3
 or exists(select 1 from public.futures_feed_runs where season_id=s and started_at>now()-interval '12 hours') then return jsonb_build_object('skipped','retry_limit'); end if;
 select jsonb_agg(to_jsonb(m)),count(distinct m.sport_key) into maps,requests from public.futures_feed_mapping m join public.bets b on b.id=m.bet_id where b.season_id=s and b.category='FUTURE' and b.status='OPEN';
 if requests=0 then return jsonb_build_object('skipped','no_supported_open_positions'); end if;
 if requests>3 or requests+(select coalesce(sum(reserved_requests),0) from public.futures_feed_runs where started_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')>p.monthly_request_limit then return jsonb_build_object('skipped','monthly_cap'); end if;
 key:=private.futures_feed_key();
 if key is null or length(key)<10 then return jsonb_build_object('skipped','feed_not_connected'); end if;
 insert into public.futures_feed_runs(season_id,week,reserved_requests) values(s,w,requests) returning id into run_id;
 return jsonb_build_object('run_id',run_id,'week',w,'mappings',maps,'api_key',key);
end $$;
revoke all on function public.claim_futures_refresh() from public,anon,authenticated;
grant execute on function public.claim_futures_refresh() to service_role;

select cron.schedule('du-shamers-futures-weekly','17 * * * *',$job$
 select net.http_post(url:='https://xvnkwtiydyrksucgiphi.supabase.co/functions/v1/refresh-futures',
 headers:='{"Content-Type":"application/json","apikey":"sb_publishable_oTJVPjW_EdOokBZfTSJKaA_GuUwJjOF","Authorization":"Bearer sb_publishable_oTJVPjW_EdOokBZfTSJKaA_GuUwJjOF"}'::jsonb,
 body:='{"scheduled":true}'::jsonb,timeout_milliseconds:=20000)
 from public.futures_feed_policy where singleton and enabled;
$job$);
