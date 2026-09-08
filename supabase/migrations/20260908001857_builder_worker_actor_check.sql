do $$ declare src text; old text; begin
old:=pg_get_functiondef('public.claim_builder_refresh()'::regprocedure);
src:=replace(old,'join auth.users u on u.id=m.profile_id join public.commissioner_allowlist c on c.league_id=l.id and c.email=lower(u.email)','');
src:=replace(src,'and u.email_confirmed_at is not null','');
if src=old then raise exception 'actor_patch_not_applied'; end if;
execute src;
end $$;
