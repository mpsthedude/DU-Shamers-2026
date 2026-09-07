# Analysis spending architecture

Release status, September 7, 2026: the weekly-analysis migrations and analyze-ticket v4, commissioner-api v11 and member-api v6 are deployed. The website release includes the usage display and commissioner budget controls. Both analysis and overall paid reservations remain paused; publishing the website does not enable spending.

The weekly winner has five fresh attempts per award, with no cooldown. Shared provider snapshots expire after 180 seconds. Existing cache hits do not consume an attempt. One request spanning multiple games reserves one weekly attempt; failed downstream requests can still consume that attempt. This is a shared query cache, not a permanent archive of whole analyses.

The integration_budget trigger enforces combined daily and monthly cost reservations across provider_requests. Provider-specific quotas, concurrency limits and the provider kill switch also apply. Costs are configured upper bounds, not reconciled invoices. SportsGameOdds objects are not separately metered. AI, news, injury and weather enrichment are not connected. Any future adapter must use the shared reservation ledger before dispatch.

Validation: 55 automated checks passed, including caching, quota denial, provider gates, authorization and ticket validation. Earlier rolled-back SQL checks verified five immediate reservations, sixth-run denial, winner eligibility and global budget boundaries. No concurrent database load test or complete live paid-analysis workflow has been performed.

Before activation: agree on overall ceilings and provider reservation costs, configure provider quotas, and verify a signed-in winner's full workflow. There is no automatic commissioner quota override. The current $99 SportsGameOdds subscription is a fixed plan; reservation amounts do not represent an additional provider invoice per request.
