-- Run in BEGIN / ROLLBACK; synthetic users never persist.
do $$
declare l uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); d uuid; r jsonb;
begin
  insert into auth.users(id,email) values(a,'commissioner@example.invalid'),(b,'owner@example.invalid'),(c,'other@example.invalid');
  if not exists(select 1 from public.profiles where id=a) then raise exception 'profile_trigger_failed'; end if;
  insert into public.leagues(id,name) values(l,'Rollback owner accounts');
  insert into public.commissioner_allowlist(league_id,email) values(l,'commissioner@example.invalid');
  insert into public.league_owner_directory(league_id,fantasy_team_id,team_name_at_import,manager_name,email) values
    (l,'3','Supreme Leader','Commissioner','commissioner@example.invalid'),(l,'13','Original name','Owner','owner@example.invalid');
  set local role service_role;
  r:=public.link_verified_owner(a,l,'commissioner@example.invalid');
  if r->>'role'<>'COMMISSIONER' or r->>'fantasy_team_id'<>'3' then raise exception 'commissioner_mapping_failed'; end if;
  r:=public.link_verified_owner(b,l,' OWNER@example.invalid ');
  if r->>'role'<>'OWNER' or r->>'fantasy_team_id'<>'13' then raise exception 'stable_id_mapping_failed'; end if;
  perform public.link_verified_owner(b,l,'owner@example.invalid');
  if (select count(*) from public.league_members where league_id=l)<>2 then raise exception 'duplicate_membership'; end if;
  update public.league_owner_directory set team_name_at_import='New name' where league_id=l and fantasy_team_id='13';
  r:=public.link_verified_owner(b,l,'owner@example.invalid');
  if r->>'fantasy_team_name'<>'New name' or r->>'fantasy_team_id'<>'13' then raise exception 'rename_broke_assignment'; end if;
  begin
    perform public.link_verified_owner(c,l,'unlisted@example.invalid'); raise exception 'expected_unlisted_rejection';
  exception when others then if sqlerrm<>'owner_email_not_authorized' then raise; end if; end;
  begin
    perform public.link_verified_owner(c,l,'owner@example.invalid'); raise exception 'expected_team_conflict';
  exception when others then if sqlerrm<>'owner_assignment_conflict' then raise; end if; end;
  begin
    perform public.link_verified_owner(b,l,'commissioner@example.invalid'); raise exception 'expected_owner_conflict';
  exception when others then if sqlerrm<>'owner_assignment_conflict' then raise; end if; end;
  select id into d from public.league_owner_directory where league_id=l and fantasy_team_id='13';
  begin
    perform public.reserve_owner_invitation(b,l,d); raise exception 'expected_commissioner_only';
  exception when others then if sqlerrm<>'commissioner_not_authorized' then raise; end if; end;
  r:=public.reserve_owner_invitation(a,l,d);
  if r->>'email'<>'owner@example.invalid' then raise exception 'wrong_invitee'; end if;
  begin
    perform public.reserve_owner_invitation(a,l,d); raise exception 'expected_duplicate_protection';
  exception when others then if sqlerrm<>'invitation_delivery_needs_review' then raise; end if; end;
  update public.league_owner_directory set invite_status='FAILED' where id=d;
  begin
    perform public.reserve_owner_invitation(a,l,d); raise exception 'expected_cooldown';
  exception when others then if sqlerrm<>'invitation_cooldown' then raise; end if; end;
  update public.league_owner_directory set invite_status='SENT' where id=d;
  r:=public.reserve_owner_invitation(a,l,d);
  if r->>'skipped'<>'invitation_already_sent' then raise exception 'sent_repeated'; end if;
  reset role;
  if has_table_privilege('anon','public.league_owner_directory','SELECT') or has_table_privilege('authenticated','public.league_owner_directory','SELECT')
    or has_function_privilege('authenticated','public.link_verified_owner(uuid,uuid,text)','EXECUTE')
    or has_function_privilege('anon','public.reserve_owner_invitation(uuid,uuid,uuid)','EXECUTE') then raise exception 'public_privilege_leak'; end if;
end;
$$;
