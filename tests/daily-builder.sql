-- Run only inside BEGIN / ROLLBACK. No HTTP calls.
do $$ declare r jsonb; begin
 update public.builder_refresh_policy set enabled=true,last_slot=null;
 update public.provider_budget set enabled=true where provider='sportsgameodds';
 update public.integration_budget set enabled=true;
 r:=public.claim_builder_refresh();
 if r->>'actor' is null then raise exception 'missing scheduled actor'; end if;
 if public.claim_builder_refresh()->>'skipped'<>'not_due' then raise exception 'duplicate job accepted'; end if;
 update public.builder_refresh_policy set last_slot=(r->>'slot')::timestamptz-interval '24 hours';
 if public.claim_builder_refresh()->>'actor' is null then raise exception 'next day blocked'; end if;
 update public.builder_refresh_policy set enabled=false;
 if public.claim_builder_refresh()->>'skipped'<>'paused' then raise exception 'pause ignored'; end if;
 if has_function_privilege('anon','public.claim_builder_refresh()','execute') then raise exception 'public claim access'; end if;
end $$;
