# Analysis spending architecture

Release status, September 7, 2026: the weekly-analysis migrations and analyze-ticket v4, commissioner-api v11 and member-api v6 are deployed. The website release includes the usage display and commissioner budget controls. Both analysis and overall paid reservations remain paused; publishing the website does not enable spending.

The weekly winner has five fresh attempts per award, with no cooldown. Shared provider snapshots expire after 180 seconds. Existing cache hits do not consume an attempt. One request spanning multiple games reserves one weekly attempt; failed downstream requests can still consume that attempt. This is a shared query cache, not a permanent archive of whole analyses.

The integration_budget trigger enforces combined daily and monthly cost reservations across provider_requests. Provider-specific quotas, concurrency limits and the provider kill switch also apply. Costs are configured upper bounds, not reconciled invoices. SportsGameOdds objects are metered as described below. AI, news, injury and weather enrichment are not connected. Any future adapter must use the shared reservation ledger before dispatch.

Validation: 55 automated checks passed, including caching, quota denial, provider gates, authorization and ticket validation. Earlier rolled-back SQL checks verified five immediate reservations, sixth-run denial, winner eligibility and global budget boundaries. No concurrent database load test or complete live paid-analysis workflow has been performed.

Before activation: agree on overall ceilings and provider reservation costs, configure provider quotas, and verify a signed-in winner's full workflow. There is no automatic commissioner quota override. The current $99 SportsGameOdds subscription is a fixed plan; reservation amounts do not represent an additional provider invoice per request.

## Shared tracker and object controls (September 7)

Object metering now applies to all provider_requests inserts, including previously deployed Edge Functions. Each request reserves the maximum 40 events allowed by our gateway; successful event-array responses replace that reservation with the returned object count. Failed/unknown requests retain 40. Cache hits do not insert requests. A local calendar-month ceiling (initially zero), a 40-request rolling-minute cap, and a provider-reported account allowance all apply. Provider usage checks are commissioner-only and limited to one per minute; a snapshot older than 24 hours blocks fresh event calls. The account check is read-only and separate from event-object accounting.

The provider reported 4,572 / 100,000 monthly objects and 50 requests/minute during verification. That observation is not a permanent or automatically refreshed account counter. External applications using the same key can consume capacity between checks; this project's local controls cannot cap those applications. The commissioner can check current usage and save an object ceiling in the Hub. All spending flags and the tracker remain paused pending activation settings.

The security advisor reports intentionally closed RLS tables without browser policies. These tables have browser grants revoked and use server-only access. Its pre-existing leaked-password protection warning remains: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.

Approved limits: 50,000 local objects/calendar month and $0 incremental spend beyond the existing subscription. The provider is explicitly marked prepaid, with zero-cost reservations allowed only for that policy. Request caps are 1,000/day, 10,000/month and 500/day per actor, with existing two-request concurrency and 40/minute guard. Global, provider, analysis and tracker switches remain paused pending live validation. Rolled-back SQL verified a zero-dollar reservation succeeds with all quotas satisfied and a positive charge fails at the zero ceiling. All 58 Node tests passed.
