-- Owner addresses are imported privately, never included in migrations/site assets.
create table public.league_owner_directory (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id),
  fantasy_team_id text not null,
  team_name_at_import text not null,
  manager_name text not null,
  email text not null check(email=lower(btrim(email))),
  active boolean not null default true,
  invite_status text not null default 'NOT_SENT' check(invite_status in ('NOT_SENT','SENDING','SENT','FAILED','UNKNOWN')),
  invite_attempt_at timestamptz, invite_sent_at timestamptz, invite_error text,
  unique(league_id,email), unique(league_id,fantasy_team_id)
);
alter table public.league_owner_directory enable row level security;
revoke all on public.league_owner_directory from anon,authenticated;
grant select,insert,update on public.league_owner_directory to service_role;

create function public.link_verified_owner(p_actor uuid,p_league uuid,p_email text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare owner public.league_owner_directory%rowtype; member public.league_members%rowtype; current_name text; role_name text;
begin
  -- Same league lock as the existing claim workflow, so claims cannot race assignment.
  perform pg_advisory_xact_lock(hashtextextended('team-claims:'||p_league::text,0));
  select * into owner from public.league_owner_directory where league_id=p_league and email=lower(btrim(p_email)) and active;
  if owner.id is null or p_actor is null then raise exception 'owner_email_not_authorized'; end if;
  select tm->>'team_name' into current_name from public.league_standings_snapshots snap
    join public.seasons s on s.id=snap.season_id cross join lateral jsonb_array_elements(snap.payload->'teams') tm
    where s.league_id=p_league and s.year=2026 and tm->>'team_id'=owner.fantasy_team_id order by snap.observed_at desc limit 1;
  current_name:=coalesce(current_name,owner.team_name_at_import);
  role_name:=case when exists(select 1 from public.commissioner_allowlist where league_id=p_league and email=owner.email)
    then 'COMMISSIONER' else 'OWNER' end;
  select * into member from public.league_members where league_id=p_league and profile_id=p_actor for update;
  if member.fantasy_team_id is not null and member.fantasy_team_id<>owner.fantasy_team_id then raise exception 'owner_assignment_conflict'; end if;
  if exists(select 1 from public.league_members where league_id=p_league and fantasy_team_id=owner.fantasy_team_id and profile_id<>p_actor)
    then raise exception 'owner_assignment_conflict'; end if;
  insert into public.profiles(id,display_name) values(p_actor,owner.manager_name) on conflict(id) do nothing;
  insert into public.league_members(league_id,profile_id,role,fantasy_team_id,fantasy_team_name)
    values(p_league,p_actor,role_name,owner.fantasy_team_id,current_name)
    on conflict(league_id,profile_id) do update set role=excluded.role,fantasy_team_id=excluded.fantasy_team_id,fantasy_team_name=excluded.fantasy_team_name
    returning * into member;
  return jsonb_build_object('id',member.id,'role',member.role,'fantasy_team_id',member.fantasy_team_id,'fantasy_team_name',member.fantasy_team_name);
end;
$$;

create function public.reserve_owner_invitation(p_actor uuid,p_league uuid,p_owner uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare owner public.league_owner_directory%rowtype;
begin
  if not exists(select 1 from public.league_members where league_id=p_league and profile_id=p_actor and role='COMMISSIONER')
    then raise exception 'commissioner_not_authorized'; end if;
  select * into owner from public.league_owner_directory where id=p_owner and league_id=p_league and active for update;
  if owner.id is null then raise exception 'owner_not_found'; end if;
  if owner.invite_status='SENT' then return jsonb_build_object('skipped','invitation_already_sent'); end if;
  if owner.invite_status in ('SENDING','UNKNOWN') then raise exception 'invitation_delivery_needs_review'; end if;
  if owner.invite_attempt_at>clock_timestamp()-interval '1 hour' then raise exception 'invitation_cooldown'; end if;
  update public.league_owner_directory set invite_status='SENDING',invite_attempt_at=clock_timestamp(),invite_error=null where id=p_owner;
  return jsonb_build_object('email',owner.email,'manager_name',owner.manager_name);
end;
$$;
revoke all on function public.link_verified_owner(uuid,uuid,text),public.reserve_owner_invitation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.link_verified_owner(uuid,uuid,text),public.reserve_owner_invitation(uuid,uuid,uuid) to service_role;
-- Trigger invocation still works; this function is not a browser-callable RPC.
revoke execute on function public.handle_new_auth_user() from public,anon,authenticated;
