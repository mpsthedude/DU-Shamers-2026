-- All claim transitions share one short league lock; no provider calls inside it.
-- Existing unique indexes enforce one active claim per team/profile and one owner per team.
grant insert, update on public.team_claims to service_role;

create or replace function public.manage_team_claim(
  p_actor uuid, p_league uuid, p_action text, p_team_id text default null,
  p_team_name text default null, p_claim uuid default null, p_note text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  c public.team_claims%rowtype;
  m public.league_members%rowtype;
  desired text;
begin
  if p_actor is null or not exists(select 1 from public.profiles where id=p_actor) then
    raise exception 'member_sign_in_required';
  end if;
  if p_action is null or p_action not in ('REQUEST','SELF_ASSIGN','CANCEL','APPROVE','REJECT') then
    raise exception 'invalid_claim_action';
  end if;
  if length(p_note)>500 then raise exception 'claim_note_too_long'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('team-claims:' || p_league::text,0));
  if not exists(select 1 from public.leagues where id=p_league) then raise exception 'league_not_found'; end if;
  select * into m from public.league_members where league_id=p_league and profile_id=p_actor;
  -- The trusted Edge Function also checks the current commissioner email allowlist.
  if p_action in ('SELF_ASSIGN','APPROVE','REJECT') and (m.id is null or m.role<>'COMMISSIONER') then
    raise exception 'commissioner_not_authorized';
  end if;
  if p_action in ('REQUEST','SELF_ASSIGN') then
    if p_team_id is null or p_team_id !~ '^[0-9]+$' or length(p_team_id)>20
      or nullif(btrim(p_team_name),'') is null or length(p_team_name)>200 then
      raise exception 'invalid_team';
    end if;
    select * into c from public.team_claims where league_id=p_league and profile_id=p_actor
      and status in ('PENDING','APPROVED');
    if c.id is not null then
      if c.fantasy_team_id<>p_team_id then raise exception 'active_claim_already_exists'; end if;
      return jsonb_build_object('ok',true,'claim',to_jsonb(c),'status',c.status,'replayed',true);
    end if;
    if m.fantasy_team_id is not null then raise exception 'team_already_assigned'; end if;
    if exists(select 1 from public.league_members where league_id=p_league and fantasy_team_id=p_team_id) then
      raise exception 'team_already_claimed';
    end if;
    if exists(select 1 from public.team_claims where league_id=p_league and fantasy_team_id=p_team_id
      and status in ('PENDING','APPROVED')) then raise exception 'team_claim_pending_or_approved'; end if;
    if p_action='SELF_ASSIGN' then
      update public.league_members set fantasy_team_id=p_team_id,fantasy_team_name=p_team_name where id=m.id;
    end if;
    insert into public.team_claims(league_id,profile_id,fantasy_team_id,fantasy_team_name,status,reviewed_by,reviewed_at,review_note)
      values(p_league,p_actor,p_team_id,p_team_name,
        case when p_action='SELF_ASSIGN' then 'APPROVED' else 'PENDING' end,
        case when p_action='SELF_ASSIGN' then p_actor end,
        case when p_action='SELF_ASSIGN' then now() end,
        case when p_action='SELF_ASSIGN' then 'Commissioner self-assignment' end) returning * into c;
  else
    select * into c from public.team_claims where id=p_claim and league_id=p_league for update;
    if c.id is null then raise exception 'claim_not_found'; end if;
    if p_action='CANCEL' and c.profile_id<>p_actor then raise exception 'claim_not_found'; end if;
    desired := case p_action when 'CANCEL' then 'CANCELLED' when 'APPROVE' then 'APPROVED' else 'REJECTED' end;
    if c.status=desired then return jsonb_build_object('ok',true,'claim_id',c.id,'status',c.status,'replayed',true); end if;
    if c.status<>'PENDING' then raise exception 'claim_already_resolved'; end if;
    if p_action='APPROVE' then
      select * into m from public.league_members where league_id=p_league and profile_id=c.profile_id;
      if m.fantasy_team_id is not null and m.fantasy_team_id<>c.fantasy_team_id then raise exception 'team_already_assigned'; end if;
      if exists(select 1 from public.league_members where league_id=p_league and fantasy_team_id=c.fantasy_team_id
        and profile_id<>c.profile_id) then raise exception 'team_already_claimed'; end if;
      insert into public.league_members(league_id,profile_id,fantasy_team_id,fantasy_team_name,role)
        values(p_league,c.profile_id,c.fantasy_team_id,c.fantasy_team_name,'OWNER')
        on conflict(league_id,profile_id) do update set
          fantasy_team_id=excluded.fantasy_team_id,fantasy_team_name=excluded.fantasy_team_name;
    end if;
    update public.team_claims set status=desired,reviewed_by=p_actor,reviewed_at=now(),review_note=p_note
      where id=c.id returning * into c;
  end if;
  return jsonb_build_object('ok',true,'claim',to_jsonb(c),'claim_id',c.id,'status',c.status,'replayed',false);
end;
$$;
revoke all on function public.manage_team_claim(uuid,uuid,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.manage_team_claim(uuid,uuid,text,text,text,uuid,text) to service_role;
