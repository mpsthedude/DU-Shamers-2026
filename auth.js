const AUTH_SUPABASE_URL = 'https://xvnkwtiydyrksucgiphi.supabase.co';
const MEMBER_API_URL = `${LIVE_API_ROOT}/member-api`;
const COMMISSIONER_API_URL = `${LIVE_API_ROOT}/commissioner-api`;
const authClient = window.supabase.createClient(AUTH_SUPABASE_URL, LIVE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

let authSession = null;
let memberSessionData = null;
let commissionerData = null;

function authHeaders() {
  return {
    apikey: LIVE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${authSession?.access_token || LIVE_PUBLISHABLE_KEY}`,
  };
}

function createMemberUi() {
  const topActions = document.querySelector('.topbar-actions');
  if (topActions && !document.querySelector('#memberAccessButton')) {
    const button = document.createElement('button');
    button.id = 'memberAccessButton';
    button.className = 'ghost-button member-access-button';
    button.textContent = 'League Sign In';
    const commissionerButton = topActions.querySelector('[data-scroll="commissioner"]');
    topActions.insertBefore(button, commissionerButton || null);
    button.addEventListener('click', openMemberModal);
  }

  if (!document.querySelector('#memberOverlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'memberOverlay';
    overlay.className = 'member-overlay hidden';
    overlay.innerHTML = `
      <section class="member-modal" role="dialog" aria-modal="true" aria-labelledby="memberModalTitle">
        <div class="member-modal-head">
          <div><div class="section-label">DU SHAMERS MEMBER ACCESS</div><h2 id="memberModalTitle">League account</h2></div>
          <button class="member-close" id="memberClose" aria-label="Close">×</button>
        </div>
        <div id="memberModalBody"></div>
      </section>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#memberClose')?.addEventListener('click', closeMemberModal);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeMemberModal(); });
  }

  const commissionerPanel = document.querySelector('#commissioner');
  if (commissionerPanel) commissionerPanel.classList.add('hidden');
}

function closeMemberModal() {
  document.querySelector('#memberOverlay')?.classList.add('hidden');
}

function openMemberModal() {
  document.querySelector('#memberOverlay')?.classList.remove('hidden');
  renderMemberModal();
}

function memberErrorText(code) {
  const map = {
    team_already_claimed: 'That fantasy team is already assigned to another owner.',
    team_claim_pending_or_approved: 'That fantasy team already has an active claim.',
    weekly_submission_window_closed: 'This week’s submission window has closed.',
    not_this_weeks_high_scorer: 'Only this week’s high-scoring fantasy team can submit the league wager.',
    weekly_ticket_already_submitted: 'This week’s ticket has already been submitted.',
    selection_unavailable: 'At least one DraftKings selection is no longer available. Refresh the live market and try again.',
    event_already_started: 'At least one selected event has already started.',
  };
  return map[code] || String(code || 'Request failed').replaceAll('_', ' ');
}

async function memberRequest(method = 'GET', body = null) {
  if (!authSession?.access_token) throw new Error('member_sign_in_required');
  const response = await fetch(MEMBER_API_URL, {
    method,
    headers: { ...authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || `member_api_${response.status}`);
    error.data = data;
    throw error;
  }
  return data;
}

async function commissionerRequest(method = 'GET', body = null) {
  if (!authSession?.access_token) throw new Error('commissioner_sign_in_required');
  const response = await fetch(COMMISSIONER_API_URL, {
    method,
    headers: { ...authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || `commissioner_api_${response.status}`);
    error.data = data;
    throw error;
  }
  return data;
}

async function sendMagicLink(email) {
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await authClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
  });
  if (error) throw error;
}

async function refreshMemberState({ refreshCommissioner = true } = {}) {
  const { data } = await authClient.auth.getSession();
  authSession = data?.session || null;
  memberSessionData = null;
  commissionerData = null;

  if (authSession) {
    try { memberSessionData = await memberRequest('GET'); }
    catch (error) { console.warn('Member session unavailable', error); }
  }

  const button = document.querySelector('#memberAccessButton');
  if (button) {
    if (!authSession) button.textContent = 'League Sign In';
    else if (memberSessionData?.membership?.fantasy_team_name) button.textContent = memberSessionData.membership.fantasy_team_name;
    else button.textContent = 'League Account';
  }

  updateSubmissionAccess();
  if (refreshCommissioner && memberSessionData?.membership?.role === 'COMMISSIONER') await loadCommissionerConsole();
  else document.querySelector('#commissioner')?.classList.add('hidden');
  renderMemberModal();
}

function renderSignedOut(body) {
  body.innerHTML = `
    <div class="member-card">
      <strong>Sign in with your email</strong>
      <span>We’ll send a one-time Supabase magic link. No league password is required.</span>
      <form class="member-form" id="memberSignInForm" style="margin-top:.8rem">
        <input id="memberEmail" type="email" required autocomplete="email" placeholder="you@example.com" />
        <button type="submit">Send sign-in link</button>
      </form>
      <div class="auth-help">After your first sign-in, choose your ESPN fantasy team. New owner claims require commissioner approval before that account can submit a weekly wager.</div>
    </div>`;
  body.querySelector('#memberSignInForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = body.querySelector('#memberEmail')?.value?.trim();
    if (!email) return;
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      await sendMagicLink(email);
      button.textContent = 'Check your email';
      showToast('Sign-in link sent. Check your email.');
    } catch (error) {
      console.warn('Magic link failed', error);
      button.disabled = false;
      button.textContent = 'Send sign-in link';
      showToast(error?.message || 'Unable to send sign-in link.');
    }
  });
}

function renderTeamClaims(body) {
  const membership = memberSessionData?.membership;
  const claim = memberSessionData?.claim;
  const teams = memberSessionData?.team_directory || [];

  if (membership?.fantasy_team_id) return '';
  if (claim?.status === 'PENDING') {
    return `<div class="member-card"><div class="member-status-row"><div><strong>${claim.fantasy_team_name}</strong><span>Team claim awaiting commissioner approval</span></div><span class="member-status-chip">PENDING</span></div><button class="member-link-button" id="cancelTeamClaim" style="margin-top:.7rem">Cancel claim</button></div>`;
  }

  return `
    <div class="member-card">
      <strong>Claim your fantasy team</strong>
      <span>Select the ESPN team you own. Another owner cannot claim it while your request is pending.</span>
      <div class="claim-team-grid">
        ${teams.map((team) => {
          const unavailable = team.claimed || team.pending_claim;
          return `<button class="claim-button ${unavailable ? '' : 'primary'}" data-team-id="${team.team_id}" ${unavailable ? 'disabled' : ''}><strong>${team.team_name}</strong><small>${unavailable ? 'Already claimed / pending' : 'Request this team'}</small></button>`;
        }).join('')}
      </div>
    </div>`;
}

function renderMemberModal() {
  const body = document.querySelector('#memberModalBody');
  if (!body) return;
  if (!authSession) return renderSignedOut(body);

  const membership = memberSessionData?.membership;
  const award = memberSessionData?.current_award;
  const eligible = memberSessionData?.eligible_weekly_winner;
  const proposal = memberSessionData?.current_proposal;
  body.innerHTML = `
    <div class="member-card">
      <div class="member-status-row">
        <div><strong>${authSession.user?.email || 'Signed in'}</strong><span>${membership?.role === 'COMMISSIONER' ? 'Commissioner account' : membership?.fantasy_team_name ? 'Approved league owner' : 'League member'}</span></div>
        <button class="member-link-button" id="memberSignOut">Sign out</button>
      </div>
    </div>
    ${renderTeamClaims(body)}
    ${membership?.fantasy_team_name ? `<div class="member-card"><strong>${membership.fantasy_team_name}</strong><span>ESPN team ${membership.fantasy_team_id} · ${membership.role}</span>${award ? `<small>Current tracked award: Week ${award.week} · ${award.fantasy_team_name || 'pending'}${eligible ? ' · YOU ARE THE WEEKLY WINNER' : ''}</small>` : ''}${proposal ? `<small>Current ticket: ${proposal.status || proposal.decision?.choice || 'decision recorded'}</small>` : ''}</div>` : ''}
    ${membership?.role === 'COMMISSIONER' ? `<div class="member-card"><strong>Commissioner controls enabled</strong><span>Team claims, submitted tickets, placement confirmation, and settlement are available in the Commissioner Queue below.</span><button class="member-link-button" id="jumpCommissioner" style="margin-top:.7rem">Open commissioner queue</button></div>` : ''}
    <div class="member-card"><button class="member-link-button" id="refreshMemberAccount">Refresh league status</button></div>`;

  body.querySelector('#memberSignOut')?.addEventListener('click', async () => { await authClient.auth.signOut(); closeMemberModal(); });
  body.querySelector('#refreshMemberAccount')?.addEventListener('click', () => refreshMemberState());
  body.querySelector('#jumpCommissioner')?.addEventListener('click', () => { closeMemberModal(); document.querySelector('#commissioner')?.scrollIntoView({ behavior: 'smooth' }); });
  body.querySelector('#cancelTeamClaim')?.addEventListener('click', async () => {
    try { await memberRequest('POST', { action: 'cancel_claim' }); await refreshMemberState(); }
    catch (error) { showToast(memberErrorText(error.message)); }
  });
  body.querySelectorAll('[data-team-id]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm(`Request ownership of ${button.querySelector('strong')?.textContent}?`)) return;
    button.disabled = true;
    try {
      const result = await memberRequest('POST', { action: 'claim_team', fantasy_team_id: button.dataset.teamId });
      showToast(result.status === 'APPROVED' ? 'Team assigned.' : 'Team claim sent to the commissioner.');
      await refreshMemberState();
    } catch (error) {
      showToast(memberErrorText(error.message));
      await refreshMemberState({ refreshCommissioner: false });
    }
  }));
}

function replaceSubmitHandler() {
  const oldButton = document.querySelector('#submitButton');
  if (!oldButton || oldButton.dataset.persistentSubmit === 'true') return;
  const button = oldButton.cloneNode(true);
  button.dataset.persistentSubmit = 'true';
  oldButton.replaceWith(button);
  button.addEventListener('click', submitPersistentTicket);
}

function updateSubmissionAccess() {
  replaceSubmitHandler();
  const button = document.querySelector('#submitButton');
  if (!button) return;
  button.disabled = false;
  if (!authSession) button.textContent = 'Sign in to submit';
  else if (!memberSessionData?.membership?.fantasy_team_id) button.textContent = 'Claim team to submit';
  else if (memberSessionData?.current_proposal?.status) { button.textContent = 'Ticket submitted ✓'; button.disabled = true; }
  else if (!memberSessionData?.eligible_weekly_winner) button.textContent = 'Weekly high scorer only';
  else if (!memberSessionData?.submission_window_open) { button.textContent = 'Submission window closed'; button.disabled = true; }
  else button.textContent = 'Submit to commissioner';
}

async function submitPersistentTicket() {
  if (!authSession || !memberSessionData?.membership?.fantasy_team_id || !memberSessionData?.eligible_weekly_winner) {
    openMemberModal();
    if (authSession && memberSessionData?.membership?.fantasy_team_id && !memberSessionData?.eligible_weekly_winner) showToast('Only this week’s high scorer can submit the league wager.');
    return;
  }
  const stake = selectedStake();
  if (!stake) return showToast('Choose the $50/$50 or Let It Ride option first.');
  if (!state.legs.length) return showToast('Build a ticket before submitting.');
  const decimal = combinedDecimal();
  const combinedOdds = state.legs.length === 1 ? state.legs[0].odds : decimalToAmerican(decimal);
  const payload = {
    action: 'submit_weekly_bet',
    choice: state.choice,
    estimated_american_odds: combinedOdds,
    estimated_return_cents: Math.round(stake * decimal * 100),
    legs: state.legs.map((leg) => ({
      event_id: leg.providerEventId || leg.eventId,
      odd_id: leg.providerOddId,
      sport: leg.sport,
      event_name: leg.eventName,
      market: leg.market,
      selection: leg.selection,
      odds: leg.odds,
      line: leg.line ?? null,
      player_name: leg.playerName ?? null,
      stat_id: leg.statId ?? null,
      bet_type: leg.betType ?? null,
      side: leg.side ?? null,
    })),
  };
  if (payload.legs.some((leg) => !leg.event_id || !leg.odd_id)) return showToast('Wait for live DraftKings markets to load before submitting.');
  const button = document.querySelector('#submitButton');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Validating live ticket…';
  try {
    const result = await memberRequest('POST', payload);
    showToast('Ticket submitted to the commissioner.');
    await refreshMemberState();
    if (result?.proposal?.id) document.querySelector('#commissioner')?.scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    console.warn('Persistent ticket submission failed', error);
    showToast(memberErrorText(error.message));
    button.disabled = false;
    button.textContent = original;
  }
}

function commissionerMoney(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
}

async function loadCommissionerConsole() {
  const panel = document.querySelector('#commissioner');
  if (!panel) return;
  try {
    commissionerData = await commissionerRequest('GET');
    panel.classList.remove('hidden');
    renderCommissionerConsole();
  } catch (error) {
    console.warn('Commissioner console unavailable', error);
    panel.classList.add('hidden');
  }
}

function renderCommissionerConsole() {
  const panel = document.querySelector('#commissioner');
  const queue = document.querySelector('#commissionerQueue');
  const count = document.querySelector('#queueCount');
  if (!panel || !queue || !commissionerData) return;
  const pendingClaims = (commissionerData.claims || []).filter((claim) => claim.status === 'PENDING');
  const pendingProposals = (commissionerData.proposals || []).filter((proposal) => proposal.status === 'AWAITING_COMMISSIONER_PLACEMENT');
  const openBets = (commissionerData.bets || []).filter((bet) => bet.status === 'OPEN');
  if (count) count.textContent = pendingClaims.length + pendingProposals.length;

  let html = '';
  if (pendingClaims.length) {
    html += '<div class="commissioner-section-title">Pending team claims</div>' + pendingClaims.map((claim) => `
      <article class="commissioner-persistent-item">
        <h3>${claim.fantasy_team_name}</h3><p>${claim.display_name} requested ESPN team ${claim.fantasy_team_id}</p>
        <div class="commissioner-actions"><button class="commissioner-action primary" data-approve-claim="${claim.id}">Approve</button><button class="commissioner-action danger" data-reject-claim="${claim.id}">Reject</button></div>
      </article>`).join('');
  }
  if (pendingProposals.length) {
    html += '<div class="commissioner-section-title">Awaiting DraftKings placement</div>' + pendingProposals.map((proposal) => `
      <article class="commissioner-persistent-item">
        <h3>${proposal.submitter?.fantasy_team_name || proposal.submitter?.display_name || 'Weekly winner'} · ${commissionerMoney(proposal.proposed_stake_cents)}</h3>
        <p>${proposal.legs?.length || 0}-leg ticket · submitted ${proposal.submitted_at ? new Date(proposal.submitted_at).toLocaleString() : '—'} · estimated ${proposal.estimated_american_odds ? formatOdds(proposal.estimated_american_odds) : 'price unavailable'}</p>
        <ul class="commissioner-leg-list">${(proposal.legs || []).map((leg) => `<li>${leg.selection} · ${formatOdds(leg.american_odds)}</li>`).join('')}</ul>
        <div class="placement-form">
          <input class="commissioner-input" id="actualOdds-${proposal.id}" placeholder="Actual DK odds, e.g. +625" />
          <input class="commissioner-input" id="ticketRef-${proposal.id}" placeholder="DK ticket/reference (optional)" />
          <button class="commissioner-action primary" data-place-proposal="${proposal.id}">Record placement</button>
        </div>
        <div class="commissioner-actions"><button class="commissioner-action danger" data-reject-proposal="${proposal.id}">Reject ticket</button></div>
      </article>`).join('');
  }
  if (openBets.length) {
    html += '<div class="commissioner-section-title">Open tickets</div>' + openBets.map((bet) => `
      <article class="commissioner-persistent-item"><h3>${bet.category} · ${formatOdds(bet.placed_american_odds)} · ${commissionerMoney(bet.stake_cents)}</h3><p>Potential return ${commissionerMoney(bet.potential_return_cents)}${bet.sportsbook_ticket_ref ? ` · DK ref ${bet.sportsbook_ticket_ref}` : ''}</p><div class="commissioner-actions"><button class="commissioner-action primary" data-settle-win="${bet.id}" data-return="${bet.potential_return_cents}">Won</button><button class="commissioner-action danger" data-settle-loss="${bet.id}">Lost</button><button class="commissioner-action" data-settle-push="${bet.id}" data-return="${bet.stake_cents}">Push/Void</button></div></article>`).join('');
  }
  if (!html) html = '<div class="empty-state"><div class="empty-icon">✓</div><p>No team claims, ticket placements, or open bets need commissioner action.</p></div>';
  queue.innerHTML = html;
  bindCommissionerActions();
}

function bindCommissionerActions() {
  document.querySelectorAll('[data-approve-claim]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm('Approve this fantasy-team claim?')) return;
    await commissionerRequest('POST', { action: 'approve_claim', claim_id: button.dataset.approveClaim });
    showToast('Team claim approved.'); await loadCommissionerConsole();
  }));
  document.querySelectorAll('[data-reject-claim]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm('Reject this fantasy-team claim?')) return;
    await commissionerRequest('POST', { action: 'reject_claim', claim_id: button.dataset.rejectClaim });
    showToast('Team claim rejected.'); await loadCommissionerConsole();
  }));
  document.querySelectorAll('[data-reject-proposal]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm('Reject this submitted ticket?')) return;
    await commissionerRequest('POST', { action: 'reject_proposal', proposal_id: button.dataset.rejectProposal });
    showToast('Ticket rejected.'); await loadCommissionerConsole();
  }));
  document.querySelectorAll('[data-place-proposal]').forEach((button) => button.addEventListener('click', async () => {
    const id = button.dataset.placeProposal;
    const odds = document.querySelector(`#actualOdds-${CSS.escape(id)}`)?.value?.trim();
    const ticketRef = document.querySelector(`#ticketRef-${CSS.escape(id)}`)?.value?.trim();
    if (!odds) return showToast('Enter the actual combined DraftKings odds first.');
    if (!window.confirm(`Confirm that you manually placed this ticket in DraftKings at ${odds}?`)) return;
    try {
      await commissionerRequest('POST', { action: 'confirm_placement', proposal_id: id, placed_american_odds: odds, sportsbook_ticket_ref: ticketRef || null });
      showToast('DraftKings placement recorded.'); await loadCommissionerConsole(); await loadLiveLeagueBank();
    } catch (error) { showToast(memberErrorText(error.message)); }
  }));
  document.querySelectorAll('[data-settle-win]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm('Settle this ticket as WON and credit its total return to the Bonus Bank?')) return;
    await commissionerRequest('POST', { action: 'settle_bet', bet_id: button.dataset.settleWin, status: 'WON', settlement_return_cents: Number(button.dataset.return) });
    showToast('Winning return credited to the Bonus Bank.'); await loadCommissionerConsole(); await loadLiveLeagueBank();
  }));
  document.querySelectorAll('[data-settle-loss]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm('Settle this ticket as LOST?')) return;
    await commissionerRequest('POST', { action: 'settle_bet', bet_id: button.dataset.settleLoss, status: 'LOST', settlement_return_cents: 0 });
    showToast('Ticket settled as lost.'); await loadCommissionerConsole(); await loadLiveLeagueBank();
  }));
  document.querySelectorAll('[data-settle-push]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm('Settle this ticket as PUSHED/VOID and return the stake?')) return;
    await commissionerRequest('POST', { action: 'settle_bet', bet_id: button.dataset.settlePush, status: 'PUSHED', settlement_return_cents: Number(button.dataset.return) });
    showToast('Returned stake recorded.'); await loadCommissionerConsole(); await loadLiveLeagueBank();
  }));
}

createMemberUi();
replaceSubmitHandler();
authClient.auth.onAuthStateChange(() => { window.setTimeout(() => refreshMemberState(), 0); });
refreshMemberState();
