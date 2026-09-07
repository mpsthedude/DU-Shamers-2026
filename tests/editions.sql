-- Run in a single BEGIN / ROLLBACK transaction only.
do $$
declare actor uuid:=gen_random_uuid(); league uuid:=gen_random_uuid(); season uuid:=gen_random_uuid();
  snapshot uuid; corrected uuid; payload jsonb; facts jsonb; entries jsonb; r jsonb; edition uuid; replacement uuid;
begin
  insert into auth.users(id,email) values(actor,actor::text||'@example.invalid');
  insert into public.leagues(id,name) values(league,'Rollback edition fixture');
  insert into public.seasons(id,league_id,year) values(season,league,2026);
  insert into public.league_members(league_id,profile_id,role) values(league,actor,'COMMISSIONER');
  payload:=jsonb_build_object('espn_league_id',290466,'year',2026,
    'teams',(select jsonb_agg(jsonb_build_object('team_id',i::text,'team_name','Team '||i)) from generate_series(1,12) i),
    'completed_weeks',jsonb_build_array(jsonb_build_object('week',1,'scores',
      (select jsonb_agg(jsonb_build_object('team_id',i::text,'score',case when i=11 then 12 else i end)) from generate_series(1,12) i))));
  insert into public.league_standings_snapshots(season_id,source_hash,observed_at,payload) values(season,repeat('a',64),now()-interval '1 hour',payload) returning id into snapshot;
  set local role service_role;
  facts:=public.weekly_edition_facts(snapshot,1);
  if (select count(*) from jsonb_array_elements(facts) f where (f->>'weekly_rank')::int=1)<>2 then raise exception 'tied_ranks_wrong'; end if;
  select jsonb_agg(jsonb_build_object('team_id',f->>'team_id','prose','Friendly commentary') order by f->>'team_id') into entries from jsonb_array_elements(facts) f;
  begin perform public.weekly_edition_facts(snapshot,2);raise exception 'expected_missing_week';
    exception when others then if sqlerrm<>'edition_week_unavailable' then raise; end if; end;
  begin perform public.manage_weekly_edition(null,season,'CREATE',1,snapshot,null,null,entries);raise exception 'expected_auth';
    exception when others then if sqlerrm<>'commissioner_not_authorized' then raise; end if; end;
  r:=public.manage_weekly_edition(actor,season,'CREATE',1,snapshot,null,null,entries);edition:=(r->>'edition_id')::uuid;
  if public.manage_weekly_edition(actor,season,'CREATE',1,snapshot,null,null,entries)->>'edition_id'<>edition::text then raise exception 'duplicate_draft'; end if;
  if exists(select 1 from public.weekly_editions where season_id=season and status='PUBLISHED') then raise exception 'draft_published_early'; end if;
  begin perform public.manage_weekly_edition(actor,season,'SAVE',null,null,edition,0,entries);raise exception 'expected_version';
    exception when others then if sqlerrm<>'edition_changed_reload' then raise; end if; end;
  begin perform public.manage_weekly_edition(actor,season,'SAVE',null,null,edition,1,entries-0);raise exception 'expected_missing_team';
    exception when others then if sqlerrm<>'invalid_edition_entries' then raise; end if; end;
  -- Team ID 3 occurs at index 5 in lexical order: 1,10,11,12,2,3,...
  begin perform public.manage_weekly_edition(actor,season,'SAVE',null,null,edition,1,jsonb_set(entries,'{5,prose}','"Contrary editorial"'));raise exception 'expected_editorial_lock';
    exception when others then if sqlerrm<>'supreme_leader_editorial_locked' then raise; end if; end;
  r:=public.manage_weekly_edition(actor,season,'SAVE',null,null,edition,1,jsonb_set(entries,'{0,prose}','"Invented 999 points"'));
  begin perform public.manage_weekly_edition(actor,season,'PUBLISH',null,null,edition,2,jsonb_set(entries,'{0,prose}','"Invented 999 points"'));raise exception 'expected_numbers';
    exception when others then if sqlerrm<>'edition_numbers_belong_in_fact_line' then raise; end if; end;
  r:=public.manage_weekly_edition(actor,season,'PUBLISH',null,null,edition,2,entries);
  if r->>'status'<>'PUBLISHED' then raise exception 'publish_failed'; end if;
  if public.manage_weekly_edition(actor,season,'PUBLISH',null,null,edition,2,entries)->>'replayed'<>'true' then raise exception 'publish_retry_failed'; end if;
  begin perform public.manage_weekly_edition(actor,season,'SAVE',null,null,edition,3,entries);raise exception 'expected_immutable';
    exception when others then if sqlerrm<>'published_edition_is_immutable' then raise; end if; end;
  r:=public.manage_weekly_edition(actor,season,'CREATE',1,snapshot,null,null,entries);replacement:=(r->>'edition_id')::uuid;
  if replacement=edition then raise exception 'missing_new_revision'; end if;
  payload:=jsonb_set(payload,'{completed_weeks,0,scores,0,score}','100');
  insert into public.league_standings_snapshots(season_id,source_hash,observed_at,payload) values(season,repeat('b',64),now(),payload) returning id into corrected;
  begin perform public.manage_weekly_edition(actor,season,'PUBLISH',null,null,replacement,1,entries);raise exception 'expected_stale';
    exception when others then if sqlerrm<>'edition_source_changed' then raise; end if; end;
  if (select status from public.weekly_editions where id=edition)<>'PUBLISHED' then raise exception 'old_publication_lost'; end if;
  r:=public.manage_weekly_edition(actor,season,'CREATE',1,corrected,null,null,entries);replacement:=(r->>'edition_id')::uuid;
  r:=public.manage_weekly_edition(actor,season,'PUBLISH',null,null,replacement,1,entries);
  if (select count(*) from public.weekly_editions where season_id=season and status='PUBLISHED')<>1
    or (select status from public.weekly_editions where id=edition)<>'ARCHIVED' then raise exception 'revision_not_atomic'; end if;
  if has_table_privilege('anon','public.weekly_editions','SELECT')
    or has_function_privilege('authenticated','public.manage_weekly_edition(uuid,uuid,text,integer,uuid,uuid,integer,jsonb)','EXECUTE')
    then raise exception 'browser_draft_access'; end if;
  reset role;
end $$;
