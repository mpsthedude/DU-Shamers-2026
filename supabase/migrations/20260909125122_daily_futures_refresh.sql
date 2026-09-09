-- Daily read-only futures observations; no changes to stakes or settlements.
alter table public.futures_feed_policy drop constraint futures_feed_policy_monthly_request_limit_check;
alter table public.futures_feed_policy add constraint futures_feed_policy_monthly_request_limit_check check(monthly_request_limit between 0 and 62);
update public.futures_feed_policy set monthly_request_limit=62 where monthly_request_limit=30;
alter table public.futures_odds_history add column snapshot_date date;
update public.futures_odds_history set snapshot_date=(fetched_at at time zone 'UTC')::date;
alter table public.futures_odds_history alter column snapshot_date set not null;
alter table public.futures_odds_history drop constraint futures_odds_history_pkey;
alter table public.futures_odds_history add primary key(bet_id,snapshot_date);
create or replace function public.claim_futures_refresh() returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.futures_feed_policy%rowtype; s uuid; w integer; snapshot jsonb; observed timestamptz;
 maps jsonb; requests integer; run_id uuid; key text;
begin
 select * into p from public.futures_feed_policy where singleton for update;
 if not p.enabled then return jsonb_build_object('skipped','paused'); end if;
 select se.id into s from public.seasons se join public.leagues l on l.id=se.league_id where se.year=2026 and l.name='DU Shamers';
 if s is null or now()>timestamptz '2027-03-01 00:00:00+00' then return jsonb_build_object('skipped','season_closed'); end if;
 select payload,observed_at into snapshot,observed from public.league_standings_snapshots where season_id=s order by observed_at desc limit 1;
 select coalesce(max((v->>'week')::integer),0) into w from jsonb_array_elements(coalesce(snapshot->'completed_weeks','[]'::jsonb)) v where (v->>'week')::integer between 1 and 18;
 -- One attempt per UTC calendar day. Failures preserve history and retry next day.
 if exists(select 1 from public.futures_feed_runs where season_id=s and started_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')
 then return jsonb_build_object('skipped','day_attempted'); end if;
 select jsonb_agg(to_jsonb(m)),count(distinct m.sport_key) into maps,requests from public.futures_feed_mapping m join public.bets b on b.id=m.bet_id where b.season_id=s and b.category='FUTURE' and b.status='OPEN';
 if requests=0 then return jsonb_build_object('skipped','no_supported_open_positions'); end if;
 if requests>3 or requests+(select coalesce(sum(reserved_requests),0) from public.futures_feed_runs where started_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')>p.monthly_request_limit then return jsonb_build_object('skipped','monthly_cap'); end if;
 key:=private.futures_feed_key();
 if key is null or length(key)<10 then return jsonb_build_object('skipped','feed_not_connected'); end if;
 insert into public.futures_feed_runs(season_id,week,reserved_requests) values(s,w,requests) returning id into run_id;
 return jsonb_build_object('run_id',run_id,'week',w,'snapshot_date',(now() at time zone 'UTC')::date,'mappings',maps,'api_key',key);
end $$;

-- Reuse the existing job and its fixed payload; change only its name and schedule.
do $$ declare j record; begin
 select * into j from cron.job where jobname='du-shamers-futures-weekly';
 if found then perform cron.unschedule(j.jobid); perform cron.schedule('du-shamers-futures-daily','20 12 * * *',j.command); end if;
end $$;
