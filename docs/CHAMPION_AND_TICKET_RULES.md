# Opening champion award and ticket compatibility

2026 retains fourteen $100 allocations ($1,400): opening slot 1 belongs to the previous champion; ESPN scoring weeks 1–13 supply ticket slots 2–14. The opening award has `award_basis=PREVIOUS_CHAMPION`, no fabricated score, and the standard Sunday 11 AM Eastern cutoff. Owner identity uses the verified email directory and stable ESPN team ID. Activation is still required. The commissioner records actual DraftKings placement.

Submission RPC rejects a champion cash split. Five-analysis entitlement follows the same award and existing budget gates. ESPN sync uses scoring week + 1 for the award slot, preserving the champion record.

`ticket-rules.js` and its typed server counterpart reject duplicates, opposing moneylines, incompatible team spreads/moneylines, contradictory totals/player props, and yes/no pairs. Browser options explain conflicts in their title and are disabled. Submission repeats checks before paid validation and on verified provider lines. Compatible middles remain selectable; this is not a guarantee of DraftKings combination acceptance. Existing same-game warning and commissioner verification remain necessary.

Primary reference: https://help.draftkings.com/hc/en-us/articles/18082871371411-How-do-I-use-the-Dynamic-Odds-feature-to-place-a-Same-Game-Parlay-US

Validation: 68 Node tests; transactional winner-sync regression including champion preservation; production-award preflight in rollback with a temporary membership verified full stake accepted and split rejected; headless browser tested forced $100, hidden split, disabled opposing moneyline and blocked direct toggle. No wager or test membership persisted.
