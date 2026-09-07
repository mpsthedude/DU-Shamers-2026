-- Only trusted Edge Functions can invoke these transactions. The Edge API must
-- validate the Auth user and commissioner email allowlist before passing actor ID.
-- SECURITY INVOKER preserves the caller's privileges; no browser grants/policies.
grant select on public.profiles, public.league_members, public.commissioner_allowlist,
  public.team_claims, public.bet_proposals, public.bet_proposal_legs,
  public.bet_legs, public.weekly_decisions to service_role;
grant insert, update on public.profiles, public.league_members to service_role;
grant insert, update on public.bets to service_role;
grant insert on public.bet_legs, public.ledger_transactions to service_role;
grant update on public.bet_proposals to service_role;
-- Row locks on seasons serialize allocation checks across different proposals.
grant update on public.seasons to service_role;

create unique index ledger_one_placement_per_bet
  on public.ledger_transactions (bet_id)
  where transaction_type = 'BET_PLACED';
create unique index ledger_one_return_per_bet
  on public.ledger_transactions (bet_id)
  where transaction_type = 'BET_SETTLEMENT_RETURN';

create function public.record_ticket_placement(
  p_actor uuid, p_season uuid, p_proposal uuid, p_odds integer,
  p_ticket_ref text default null, p_placed_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_season public.seasons%rowtype;
  v_proposal public.bet_proposals%rowtype;
  v_bet public.bets%rowtype;
  v_available bigint;
  v_potential integer;
  v_account text;
  v_placed timestamptz := coalesce(p_placed_at, now());
begin
  if p_odds is null or (p_odds > -100 and p_odds < 100) then
    raise exception 'invalid_american_odds';
  end if;
  if length(p_ticket_ref) > 200 or not isfinite(v_placed) or v_placed > now() then
    raise exception 'invalid_placement_details';
  end if;
  select * into v_season from public.seasons where id = p_season for update;
  if not found then raise exception 'season_not_found'; end if;
  if not exists (select 1 from public.league_members where league_id = v_season.league_id
    and profile_id = p_actor and role = 'COMMISSIONER') then
    raise exception 'commissioner_not_authorized';
  end if;
  select * into v_proposal from public.bet_proposals
    where id = p_proposal and season_id = p_season for update;
  if not found then raise exception 'proposal_not_found'; end if;

  select * into v_bet from public.bets where proposal_id = p_proposal;
  if found then
    if v_proposal.status = 'PLACED' and v_bet.placed_american_odds = p_odds
      and v_bet.sportsbook_ticket_ref is not distinct from nullif(btrim(p_ticket_ref), '')
      and (p_placed_at is null or v_bet.placed_at = p_placed_at) then
      return jsonb_build_object('ok', true, 'bet', to_jsonb(v_bet), 'replayed', true);
    end if;
    raise exception 'placement_conflict';
  end if;
  if v_proposal.status <> 'AWAITING_COMMISSIONER_PLACEMENT' then
    raise exception 'proposal_not_awaiting_placement';
  end if;
  if not exists (select 1 from public.bet_proposal_legs where proposal_id = p_proposal) then
    raise exception 'proposal_legs_required';
  end if;
  if v_proposal.category = 'FUTURE' then
    select v_season.futures_budget_cents - coalesce(sum(stake_cents), 0)
      into v_available from public.bets where season_id = p_season and category = 'FUTURE';
    v_account := 'FUTURES_ALLOCATION';
  elsif v_proposal.category = 'SUPER_BOWL' then
    select coalesce(sum(amount_cents), 0) into v_available
      from public.ledger_transactions where season_id = p_season and account = 'BONUS_BANK';
    v_account := 'BONUS_BANK';
  else
    select v_season.weekly_budget_cents + coalesce(sum(amount_cents), 0) into v_available
      from public.ledger_transactions where season_id = p_season
      and account in ('WEEKLY_ALLOCATION','CASH_PAYOUTS') and amount_cents < 0;
    v_account := 'WEEKLY_ALLOCATION';
  end if;
  if v_proposal.proposed_stake_cents > v_available then raise exception 'allocation_exceeded'; end if;
  v_potential := round(v_proposal.proposed_stake_cents::numeric *
    case when p_odds > 0 then 1 + p_odds::numeric / 100
    else 1 + 100 / abs(p_odds::numeric) end);
  insert into public.bets (season_id, proposal_id, category, sportsbook, stake_cents,
    placed_american_odds, potential_return_cents, status, sportsbook_ticket_ref, placed_at)
  values (p_season, p_proposal, v_proposal.category, 'draftkings', v_proposal.proposed_stake_cents,
    p_odds, v_potential, 'OPEN', nullif(btrim(p_ticket_ref), ''), v_placed) returning * into v_bet;
  insert into public.bet_legs (bet_id, provider, bookmaker, sport, event_id, market_id,
    odd_id, event_name, market_name, selection, ticket_american_odds, event_start_at, status, sort_order)
  select v_bet.id, provider, 'draftkings', sport, event_id, market_id, odd_id, event_name,
    market_name, selection, american_odds, event_start_at, 'UPCOMING', sort_order
    from public.bet_proposal_legs where proposal_id = p_proposal;
  update public.bet_proposals set status = 'PLACED' where id = p_proposal;
  insert into public.ledger_transactions (season_id, account, transaction_type, amount_cents,
    bet_id, description, occurred_at, created_by, metadata)
  values (p_season, v_account, 'BET_PLACED', -v_bet.stake_cents, v_bet.id,
    v_proposal.category || ' DraftKings wager placed', v_placed, p_actor,
    jsonb_build_object('placed_american_odds', p_odds, 'sportsbook_ticket_ref', v_bet.sportsbook_ticket_ref));
  return jsonb_build_object('ok', true, 'bet', to_jsonb(v_bet), 'replayed', false);
end;
$$;

create function public.record_ticket_settlement(
  p_actor uuid, p_season uuid, p_bet uuid, p_status text, p_return_cents integer default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_bet public.bets%rowtype;
  v_return integer;
  v_league uuid;
begin
  if p_status is null or p_status not in ('WON','LOST','PUSHED','VOID') then
    raise exception 'invalid_settlement_status';
  end if;
  select league_id into v_league from public.seasons where id = p_season;
  if not exists (select 1 from public.league_members where league_id = v_league
    and profile_id = p_actor and role = 'COMMISSIONER') then
    raise exception 'commissioner_not_authorized';
  end if;
  select * into v_bet from public.bets where id = p_bet and season_id = p_season for update;
  if not found then raise exception 'bet_not_found'; end if;
  v_return := case when p_status = 'LOST' then 0
    when p_status in ('PUSHED','VOID') then v_bet.stake_cents else p_return_cents end;
  if v_return is null or v_return < 0 or (p_status = 'WON' and v_return <= 0) then
    raise exception 'invalid_settlement_return';
  end if;
  if p_status in ('LOST','PUSHED','VOID') and p_return_cents is not null and p_return_cents <> v_return then
    raise exception 'invalid_settlement_return';
  end if;
  if v_bet.status <> 'OPEN' then
    if v_bet.status = p_status and v_bet.settlement_return_cents = v_return then
      return jsonb_build_object('ok', true, 'bet_id', p_bet, 'status', p_status,
        'settlement_return_cents', v_return, 'replayed', true);
    end if;
    raise exception 'settlement_conflict';
  end if;
  update public.bets set status = p_status, settled_at = now(), settlement_return_cents = v_return
    where id = p_bet;
  if v_return > 0 then
    insert into public.ledger_transactions (season_id, account, transaction_type, amount_cents,
      bet_id, description, occurred_at, created_by, metadata)
    values (p_season, 'BONUS_BANK', 'BET_SETTLEMENT_RETURN', v_return, p_bet,
      p_status || ' DraftKings wager return', now(), p_actor,
      jsonb_build_object('settlement_status', p_status));
  end if;
  return jsonb_build_object('ok', true, 'bet_id', p_bet, 'status', p_status,
    'settlement_return_cents', v_return, 'replayed', false);
end;
$$;

revoke all on function public.record_ticket_placement(uuid,uuid,uuid,integer,text,timestamptz) from public, anon, authenticated;
revoke all on function public.record_ticket_settlement(uuid,uuid,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.record_ticket_placement(uuid,uuid,uuid,integer,text,timestamptz) to service_role;
grant execute on function public.record_ticket_settlement(uuid,uuid,uuid,text,integer) to service_role;
