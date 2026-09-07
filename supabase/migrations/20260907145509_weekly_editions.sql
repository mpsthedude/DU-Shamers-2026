create table public.weekly_editions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id),
  week integer not null check(week between 1 and 18),
  revision integer not null,
  version integer not null default 1,
  source_snapshot_id uuid not null references public.league_standings_snapshots(id),
  facts jsonb not null, entries jsonb not null,
  status text not null default 'DRAFT' check(status in ('DRAFT','PUBLISHED','ARCHIVED')),
  generator text not null default 'league-roast-rules-v1',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), published_at timestamptz,
  unique(season_id,week,revision)
);
create unique index weekly_edition_one_published on public.weekly_editions(season_id,week) where status='PUBLISHED';
create unique index weekly_edition_one_draft on public.weekly_editions(season_id,week) where status='DRAFT';
alter table public.weekly_editions enable row level security;
revoke all on public.weekly_editions from anon,authenticated;
grant select,insert,update on public.weekly_editions to service_role;

create function public.weekly_edition_facts(p_snapshot uuid,p_week integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare payload jsonb; scores jsonb; result jsonb;
begin
  select s.payload into payload from public.league_standings_snapshots s where s.id=p_snapshot;
  if payload is null or p_week is null or p_week not between 1 and 18 then raise exception 'edition_week_unavailable'; end if;
  select w->'scores' into scores from jsonb_array_elements(payload->'completed_weeks') w where (w->>'week')::integer=p_week;
  if scores is null or jsonb_typeof(scores)<>'array' or jsonb_array_length(scores)<>12
    or (select count(distinct x->>'team_id') from jsonb_array_elements(scores) x)<>12
    then raise exception 'edition_week_unavailable'; end if;
  with ranked as (
    select x->>'team_id' team_id,(x->>'score')::numeric score,
      rank() over(order by (x->>'score')::numeric desc) weekly_rank
    from jsonb_array_elements(scores) x
  ) select jsonb_agg(jsonb_build_object('team_id',r.team_id,'team_name',tm->>'team_name','score',r.score,'weekly_rank',r.weekly_rank) order by r.team_id)
    into result from ranked r join jsonb_array_elements(payload->'teams') tm on tm->>'team_id'=r.team_id;
  if coalesce(jsonb_array_length(result),0)<>12 or exists(select 1 from jsonb_array_elements(result) x
    where x->>'team_name' is null or x->>'score' is null) then raise exception 'edition_week_unavailable'; end if;
  return result;
end;
$$;

create function public.manage_weekly_edition(p_actor uuid,p_season uuid,p_action text,
  p_week integer default null,p_snapshot uuid default null,p_edition uuid default null,
  p_version integer default null,p_entries jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare league uuid; latest uuid; facts jsonb; e public.weekly_editions%rowtype; cleaned jsonb; next_revision integer;
begin
  select league_id into league from public.seasons where id=p_season for update;
  if not found then raise exception 'season_not_found'; end if;
  if not exists(select 1 from public.league_members where league_id=league and profile_id=p_actor and role='COMMISSIONER')
    then raise exception 'commissioner_not_authorized'; end if;
  if p_action is null or p_action not in ('CREATE','SAVE','PUBLISH') then raise exception 'invalid_edition_action'; end if;
  select id into latest from public.league_standings_snapshots where season_id=p_season order by observed_at desc,id desc limit 1;
  if p_action='CREATE' then
    if not exists(select 1 from public.league_standings_snapshots where id=p_snapshot and season_id=p_season)
      then raise exception 'edition_source_unavailable'; end if;
    facts:=public.weekly_edition_facts(p_snapshot,p_week);
    if facts is distinct from public.weekly_edition_facts(latest,p_week) then raise exception 'edition_source_changed'; end if;
    select * into e from public.weekly_editions where season_id=p_season and week=p_week and status='DRAFT';
    if e.id is not null and e.facts=facts then return jsonb_build_object('ok',true,'edition_id',e.id,'replayed',true); end if;
  else
    select * into e from public.weekly_editions where id=p_edition and season_id=p_season for update;
    if e.id is null then raise exception 'edition_not_found'; end if;
    facts:=e.facts;
    if e.status='PUBLISHED' and p_action='PUBLISH' and e.entries=p_entries then
      return jsonb_build_object('ok',true,'edition_id',e.id,'replayed',true); end if;
    if e.status<>'DRAFT' then raise exception 'published_edition_is_immutable'; end if;
    if p_version is distinct from e.version then raise exception 'edition_changed_reload'; end if;
  end if;
  if p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)<>12 or pg_column_size(p_entries)>40000
    or (select count(distinct x->>'team_id') from jsonb_array_elements(p_entries) x)<>12
    or exists(select 1 from jsonb_array_elements(p_entries) x where jsonb_typeof(x->'prose') is distinct from 'string'
      or length(btrim(x->>'prose')) not between 1 and 2000
      or not exists(select 1 from jsonb_array_elements(facts) f where f->>'team_id'=x->>'team_id'))
    then raise exception 'invalid_edition_entries'; end if;
  select jsonb_agg(jsonb_build_object('team_id',x->>'team_id','prose',btrim(x->>'prose')) order by x->>'team_id')
    into cleaned from jsonb_array_elements(p_entries) x;
  -- The Supreme Leader editorial treatment is fixed; scores remain the actual ESPN facts.
  if p_action<>'CREATE' and (select x->>'prose' from jsonb_array_elements(cleaned) x where x->>'team_id'='3')
    is distinct from (select x->>'prose' from jsonb_array_elements(e.entries) x where x->>'team_id'='3')
    then raise exception 'supreme_leader_editorial_locked'; end if;
  if p_action='CREATE' then
    update public.weekly_editions set status='ARCHIVED' where season_id=p_season and week=p_week and status='DRAFT';
    select coalesce(max(revision),0)+1 into next_revision from public.weekly_editions where season_id=p_season and week=p_week;
    insert into public.weekly_editions(season_id,week,revision,source_snapshot_id,facts,entries,created_by)
      values(p_season,p_week,next_revision,p_snapshot,facts,cleaned,p_actor) returning * into e;
  elsif p_action='SAVE' then
    update public.weekly_editions set entries=cleaned,version=version+1 where id=e.id returning * into e;
  else
    if facts is distinct from public.weekly_edition_facts(latest,e.week) then raise exception 'edition_source_changed'; end if;
    -- Keep score/record numbers in the verified fact line, separate from editable jokes.
    if exists(select 1 from jsonb_array_elements(cleaned) x where x->>'prose' ~ '[0-9]')
      then raise exception 'edition_numbers_belong_in_fact_line'; end if;
    update public.weekly_editions set status='ARCHIVED' where season_id=p_season and week=e.week and status='PUBLISHED';
    update public.weekly_editions set entries=cleaned,status='PUBLISHED',published_at=clock_timestamp(),version=version+1
      where id=e.id returning * into e;
  end if;
  return jsonb_build_object('ok',true,'edition_id',e.id,'version',e.version,'status',e.status);
end;
$$;
revoke all on function public.weekly_edition_facts(uuid,integer) from public,anon,authenticated;
revoke all on function public.manage_weekly_edition(uuid,uuid,text,integer,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.weekly_edition_facts(uuid,integer),public.manage_weekly_edition(uuid,uuid,text,integer,uuid,uuid,integer,jsonb) to service_role;
