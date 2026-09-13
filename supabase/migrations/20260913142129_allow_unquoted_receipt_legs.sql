-- Receipts for same-game parlays may quote only the combined price.
-- Member submission validation still requires verified individual prices.
alter table public.bet_proposal_legs alter column american_odds drop not null;
