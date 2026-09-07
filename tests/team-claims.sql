-- Must be wrapped in BEGIN ... ROLLBACK. No fixtures may persist.
create function pg_temp.reject_claim_write() returns trigger language plpgsql as $$
begin
  if current_setting('du_shamers.fail_claim',true)='on' then raise exception 'test_claim_failure'; end if;
  return new;
end;
$$;
create trigger claim_test_failure before insert or update on public.team_claims
  for each row execute function pg_temp.reject_claim_write();

do $$
declare
  commissioner uuid := gen_random_uuid();
  owner1 uuid := gen_random_uuid();
  owner2 uuid := gen_random_uuid();
  league uuid := gen_random_uuid();
  other_league uuid := gen_random_uuid();
  c uuid;
  c2 uuid;
  r jsonb;
begin
  insert into auth.users(id,email) values
    (commissioner,commissioner::text || '@example.invalid'),
    (owner1,owner1::text || '@example.invalid'),(owner2,owner2::text || '@example.invalid');
  insert into public.leagues(id,name) values(league,'Rollback claims fixture'),(other_league,'Rollback other league');
  insert into public.league_members(league_id,profile_id,role)
    values(league,commissioner,'COMMISSIONER'),(other_league,commissioner,'COMMISSIONER');
  -- Exercise RPCs with the actual runtime database role, not postgres privileges.
  set local role service_role;
  r:=public.manage_team_claim(owner1,league,'REQUEST','1','Team One');
  c:=(r->'claim'->>'id')::uuid;
  if r->>'status'<>'PENDING' then raise exception 'expected_pending'; end if;
  r:=public.manage_team_claim(owner1,league,'REQUEST','1','Team One');
  if r->>'replayed'<>'true' or (r->'claim'->>'id')::uuid<>c then raise exception 'request_replay_failed'; end if;
  begin
    perform public.manage_team_claim(owner1,league,'REQUEST','2','Team Two');
    raise exception 'expected_active_claim_conflict';
  exception when others then if sqlerrm<>'active_claim_already_exists' then raise; end if; end;
  begin
    perform public.manage_team_claim(owner2,league,'REQUEST','1','Team One');
    raise exception 'expected_team_conflict';
  exception when others then if sqlerrm<>'team_claim_pending_or_approved' then raise; end if; end;
  begin
    perform public.manage_team_claim(owner2,league,'CANCEL',p_claim=>c);
    raise exception 'expected_ownership_check';
  exception when others then if sqlerrm<>'claim_not_found' then raise; end if; end;
  begin
    perform public.manage_team_claim(owner2,league,'APPROVE',p_claim=>c);
    raise exception 'expected_commissioner_check';
  exception when others then if sqlerrm<>'commissioner_not_authorized' then raise; end if; end;
  begin
    perform public.manage_team_claim(commissioner,other_league,'APPROVE',p_claim=>c);
    raise exception 'expected_league_check';
  exception when others then if sqlerrm<>'claim_not_found' then raise; end if; end;

  perform set_config('du_shamers.fail_claim','on',true);
  begin
    perform public.manage_team_claim(commissioner,league,'APPROVE',p_claim=>c);
    raise exception 'expected_approval_rollback';
  exception when others then if sqlerrm<>'test_claim_failure' then raise; end if; end;
  if exists(select 1 from public.league_members where league_id=league and profile_id=owner1)
    or (select status from public.team_claims where id=c)<>'PENDING' then raise exception 'partial_approval'; end if;
  perform set_config('du_shamers.fail_claim','off',true);
  perform public.manage_team_claim(commissioner,league,'APPROVE',p_claim=>c);
  r:=public.manage_team_claim(commissioner,league,'APPROVE',p_claim=>c);
  if r->>'replayed'<>'true' or
    (select fantasy_team_id from public.league_members where league_id=league and profile_id=owner1)<>'1'
    then raise exception 'approval_failed'; end if;
  begin
    perform public.manage_team_claim(owner1,league,'CANCEL',p_claim=>c);
    raise exception 'expected_resolved_conflict';
  exception when others then if sqlerrm<>'claim_already_resolved' then raise; end if; end;

  r:=public.manage_team_claim(owner2,league,'REQUEST','2','Team Two'); c2:=(r->'claim'->>'id')::uuid;
  perform public.manage_team_claim(owner2,league,'CANCEL',p_claim=>c2);
  r:=public.manage_team_claim(owner2,league,'REQUEST','3','Team Three'); c:=(r->'claim'->>'id')::uuid;
  r:=public.manage_team_claim(owner2,league,'CANCEL',p_claim=>c2);
  if r->>'replayed'<>'true' or (select status from public.team_claims where id=c)<>'PENDING'
    then raise exception 'late_cancel_changed_new_claim'; end if;
  perform public.manage_team_claim(commissioner,league,'REJECT',p_claim=>c);
  r:=public.manage_team_claim(commissioner,league,'REJECT',p_claim=>c);
  if r->>'replayed'<>'true' then raise exception 'reject_replay_failed'; end if;
  begin
    perform public.manage_team_claim(commissioner,league,'APPROVE',p_claim=>c);
    raise exception 'expected_rejected_conflict';
  exception when others then if sqlerrm<>'claim_already_resolved' then raise; end if; end;
  begin
    perform public.manage_team_claim(owner2,league,'SELF_ASSIGN','4','Team Four');
    raise exception 'expected_self_assignment_auth';
  exception when others then if sqlerrm<>'commissioner_not_authorized' then raise; end if; end;
  perform set_config('du_shamers.fail_claim','on',true);
  begin
    perform public.manage_team_claim(commissioner,league,'SELF_ASSIGN','4','Team Four');
    raise exception 'expected_self_assignment_rollback';
  exception when others then if sqlerrm<>'test_claim_failure' then raise; end if; end;
  if exists(select 1 from public.league_members where league_id=league and profile_id=commissioner and fantasy_team_id is not null)
    then raise exception 'partial_self_assignment'; end if;
  perform set_config('du_shamers.fail_claim','off',true);
  perform public.manage_team_claim(commissioner,league,'SELF_ASSIGN','4','Team Four');
  r:=public.manage_team_claim(commissioner,league,'SELF_ASSIGN','4','Team Four');
  if r->>'replayed'<>'true' then raise exception 'self_assignment_replay_failed'; end if;
  if has_function_privilege('anon','public.manage_team_claim(uuid,uuid,text,text,text,uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.manage_team_claim(uuid,uuid,text,text,text,uuid,text)','EXECUTE')
    then raise exception 'browser_rpc_exposed'; end if;
  reset role;
end;
$$;
