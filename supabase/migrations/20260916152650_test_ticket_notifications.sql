-- Deliver isolated test submissions to real commissioners, explicitly labeled by the worker.
create or replace function public.enqueue_commissioner_push() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.category='WEEKLY' and new.status='AWAITING_COMMISSIONER_PLACEMENT' then
  insert into public.push_deliveries(subscription_id,proposal_id)
  select ps.id,new.id from public.push_subscriptions ps
  join public.league_members m on m.profile_id=ps.profile_id and m.league_id=ps.league_id and m.role='COMMISSIONER'
  join public.leagues recipient on recipient.id=ps.league_id
  join public.seasons s on s.id=new.season_id
  join public.leagues source on source.id=s.league_id
  where s.league_id=ps.league_id or (source.name='DU Shamers Test' and recipient.name='DU Shamers'
    and exists(select 1 from public.league_members tm where tm.league_id=source.id and tm.profile_id=ps.profile_id and tm.role='COMMISSIONER'))
  on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function public.enqueue_commissioner_push() from public,anon,authenticated;
