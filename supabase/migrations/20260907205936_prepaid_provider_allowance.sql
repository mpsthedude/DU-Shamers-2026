-- Subscription-covered requests may reserve $0; object and request quotas still apply.
alter table public.provider_budget add column prepaid_subscription boolean not null default false;
alter table public.provider_budget add constraint prepaid_zero_incremental_cost check(not prepaid_subscription or max_request_cost_microusd=0);
do $$ declare src text; original text; begin
 original:=pg_get_functiondef('public.reserve_provider_request(text,uuid,boolean)'::regprocedure);
 src:=replace(original,'b.max_request_cost_microusd<=0 or day_count', '(b.max_request_cost_microusd<=0 and not b.prepaid_subscription) or day_count');
 if src=original then raise exception 'reservation_patch_not_applied'; end if; execute src;
 original:=pg_get_functiondef('public.enforce_integration_budget()'::regprocedure);
 src:=replace(original,'new.reserved_microusd<=0 or day_cost', '(new.reserved_microusd<=0 and not exists(select 1 from public.provider_budget p where p.provider=new.provider and p.prepaid_subscription and p.max_request_cost_microusd=0)) or day_cost');
 if src=original then raise exception 'integration_patch_not_applied'; end if; execute src;
end $$;
