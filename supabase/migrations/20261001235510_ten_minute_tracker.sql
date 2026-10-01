-- Scheduler checks the lease each minute; paid refreshes occur no more than once per ten minutes.
create or replace function public.claim_tracker_refresh() returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.tracker_policy%rowtype; a uuid; events jsonb; token uuid:=gen_random_uuid();
begin
 select * into p from public.tracker_policy where singleton for update;
 if not p.enabled then return jsonb_build_object('skipped','paused'); end if;
 if p.last_attempt_at>clock_timestamp()-interval '600 seconds' or p.lease_until>clock_timestamp() then return jsonb_build_object('skipped','not_due'); end if;
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

update public.tracker_policy set enabled=true where singleton;
