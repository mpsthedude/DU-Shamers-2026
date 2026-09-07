-- Execute inside BEGIN / ROLLBACK only; the temporary function change is rolled back.
do $$ declare actor uuid:=gen_random_uuid(); league uuid:=gen_random_uuid(); season uuid:=gen_random_uuid(); proposal uuid; bet uuid; r jsonb; begin
 execute replace(pg_get_functiondef('public.claim_tracker_refresh()'::regprocedure),'''DU Shamers''','''Tracker rollback fixture''');
 insert into auth.users(id,email,email_confirmed_at) values(actor,actor::text||'@example.invalid',now());
 insert into public.leagues(id,name) values(league,'Tracker rollback fixture');
 insert into public.seasons(id,league_id,year) values(season,league,2026);
 insert into public.league_members(league_id,profile_id,role) values(league,actor,'COMMISSIONER');
 insert into public.commissioner_allowlist(league_id,email) values(league,actor::text||'@example.invalid');
 update public.tracker_policy set enabled=true,last_attempt_at=null,lease_until=null where singleton;
 if public.claim_tracker_refresh()->>'skipped'<>'no_active_games' then raise exception 'idle job did not stop'; end if;
 insert into public.bet_proposals(season_id,category,sport,proposed_stake_cents,status) values(season,'WEEKLY','NFL',5000,'PLACED') returning id into proposal;
 insert into public.bet_proposal_legs(proposal_id,provider,sport,event_id,odd_id,event_name,market_name,selection,american_odds,event_start_at,observed_at)
 values(proposal,'sportsgameodds','NFL','tracker-fixture','points-home-game-ml-home','Fixture','ML','Home',150,now(),now());
 insert into public.bets(season_id,proposal_id,category,sportsbook,stake_cents,placed_american_odds,potential_return_cents,status,placed_at)
 values(season,proposal,'WEEKLY','draftkings',5000,150,12500,'OPEN',now()) returning id into bet;
 r:=public.claim_tracker_refresh(); if r->>'lease_id' is null or jsonb_array_length(r->'events')<>1 then raise exception 'claim failed'; end if;
 if public.claim_tracker_refresh()->>'skipped'<>'not_due' then raise exception 'duplicate claim accepted'; end if;
 update public.tracker_policy set last_attempt_at=now()-interval '181 seconds',lease_until=null where singleton;
 insert into public.tracker_events values('tracker-fixture',now(),true,'{"phase":"finished"}');
 if public.claim_tracker_refresh()->>'skipped'<>'no_active_games' then raise exception 'terminal game refreshed'; end if;
 if (select status from public.bets where id=bet)<>'OPEN' then raise exception 'progress changed settlement'; end if;
end $$;
