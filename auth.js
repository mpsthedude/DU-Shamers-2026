function escapeMemberText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

const AUTH_SUPABASE_URL = 'https://xvnkwtiydyrksucgiphi.supabase.co';
const MEMBER_API_URL = `${LIVE_API_ROOT}/member-api`;
const COMMISSIONER_API_URL = `${LIVE_API_ROOT}/commissioner-api`;
let incomingAuthType = new URLSearchParams(window.location.hash.slice(1)).get('type');
const incomingAuthError = new URLSearchParams(window.location.hash.slice(1)).has('error');
let passwordMode = null;
let accountActionBusy = false;
const authClient = window.supabase.createClient(AUTH_SUPABASE_URL, LIVE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

let authSession = null;
let memberSessionData = null;
let commissionerData = null;
let pendingWeeklySubmission = null;

function authHeaders() {
  return {
    apikey: LIVE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${authSession?.access_token || LIVE_PUBLISHABLE_KEY}`,
  };
}
window.duShamersAuthHeaders = authHeaders;

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
    edition_source_changed: 'ESPN facts changed. Create a new draft from the latest snapshot before publishing.',
    edition_changed_reload: 'This draft was updated elsewhere. Reload the commissioner queue before editing again.',
    edition_numbers_belong_in_fact_line: 'Keep numbers in the verified score lines. Remove numeric stats from the jokes before publishing.',
    edition_week_unavailable: 'A complete ESPN scoring week is required for a recap.',
    weekly_award_review_required: 'This award needs commissioner review before another placement can be recorded.',
    team_already_claimed: 'That fantasy team is already assigned to another owner.',
    team_claim_pending_or_approved: 'That fantasy team already has an active claim.',
    weekly_submission_window_closed: 'This week’s submission window has closed.',
    not_this_weeks_high_scorer: 'Only this week’s high-scoring fantasy team can submit the league wager.',
    weekly_ticket_already_submitted: 'This week’s ticket has already been submitted.',
    selection_unavailable: 'At least one DraftKings selection is no longer available. Refresh the live market and try again.',
    selection_changed: 'DraftKings changed a price or line. Refresh the markets and review your ticket before submitting again.',
    stale_weekly_award: 'The weekly award has changed. Refresh your league account before submitting.',
    legs_limit: 'Choose between 1 and 12 selections.',
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
  if(typeof renderAnalysisAllowance==='function')renderAnalysisAllowance(memberSessionData?.analysis_usage,Boolean(authSession),Boolean(memberSessionData?.eligible_weekly_winner));
  if (refreshCommissioner && memberSessionData?.membership?.role === 'COMMISSIONER') await loadCommissionerConsole();
  else document.querySelector('#commissioner')?.classList.add('hidden');
  renderMemberModal();
}

function renderSignedOut(body) {
  renderAccountSignIn(body);
}

function renderTeamClaims(body) {
  const membership = memberSessionData?.membership;
  const claim = memberSessionData?.claim;
  const teams = memberSessionData?.team_directory || [];

  if (membership?.fantasy_team_id) return '';
  if (claim?.status === 'PENDING') {
    return `<div class="member-card"><div class="member-status-row"><div><strong>${escapeMemberText(claim.fantasy_team_name)}</strong><span>Team claim awaiting commissioner approval</span></div><span class="member-status-chip">PENDING</span></div><button class="member-link-button" id="cancelTeamClaim" style="margin-top:.7rem">Cancel claim</button></div>`;
  }

  return `
    <div class="member-card">
      <strong>Claim your fantasy team</strong>
      <span>Select the ESPN team you own. Another owner cannot claim it while your request is pending.</span>
      <div class="claim-team-grid">
        ${teams.map((team) => {
          const unavailable = team.claimed || team.pending_claim;
          return `<button class="claim-button ${unavailable ? '' : 'primary'}" data-team-id="${escapeMemberText(team.team_id)}" ${unavailable ? 'disabled' : ''}><strong>${escapeMemberText(team.team_name)}</strong><small>${unavailable ? 'Already claimed / pending' : 'Request this team'}</small></button>`;
        }).join('')}
      </div>
    </div>`;
}

function renderMemberModal() {
  const body = document.querySelector('#memberModalBody');
  if (!body) return;
  if (accountActionBusy) return;
  if (!authSession) return renderSignedOut(body);
  if (passwordMode) return renderAccountPassword(body,passwordMode);

  const membership = memberSessionData?.membership;
  const award = memberSessionData?.current_award;
  const eligible = memberSessionData?.eligible_weekly_winner;
  const proposal = memberSessionData?.current_proposal;
  body.innerHTML = `
    <div class="member-card">
      <div class="member-status-row">
        <div><strong>${escapeMemberText(authSession.user?.email || 'Signed in')}</strong><span>${membership?.role === 'COMMISSIONER' ? 'Commissioner account' : membership?.fantasy_team_name ? 'Approved league owner' : 'League member'}</span></div>
        <button class="member-link-button" id="memberSignOut">Sign out</button>
      </div>
    </div>
    ${membership ? '' : '<div class="member-card"><strong>Team access unavailable</strong><span>Use the email address on your league invitation. Contact the commissioner if your account needs a different email mapping.</span></div>'}
    ${membership?.fantasy_team_name ? `<div class="member-card"><strong>${escapeMemberText(membership.fantasy_team_name)}</strong><span>ESPN team ${escapeMemberText(membership.fantasy_team_id)} · ${escapeMemberText(membership.role)}</span>${award ? `<small>Current tracked award: Week ${award.week} · ${escapeMemberText(award.fantasy_team_name || 'pending')}${eligible ? ' · YOU ARE THE WEEKLY WINNER' : ''}</small>` : ''}${proposal ? `<small>Current ticket: ${escapeMemberText(proposal.status || proposal.decision?.choice || 'decision recorded')}</small>` : ''}</div>` : ''}
    ${membership?.role === 'COMMISSIONER' ? `<div class="member-card"><strong>Commissioner controls enabled</strong><span>Team claims, submitted tickets, placement confirmation, and settlement are available in the Commissioner Queue below.</span><button class="member-link-button" id="jumpCommissioner" style="margin-top:.7rem">Open commissioner queue</button></div>` : ''}
    <div class="member-card"><strong>Account settings</strong><p>Your sign-in email is managed by the commissioner so team ownership stays accurate.</p><button class="member-link-button" id="changeAccountPassword">Change password</button> <button class="member-link-button" id="refreshMemberAccount">Refresh league status</button></div>`;

  body.querySelector('#memberSignOut')?.addEventListener('click', async () => { await authClient.auth.signOut(); closeMemberModal(); });
  body.querySelector('#refreshMemberAccount')?.addEventListener('click', () => refreshMemberState());
  body.querySelector('#changeAccountPassword')?.addEventListener('click',()=>{passwordMode='change';renderMemberModal();});
  body.querySelector('#jumpCommissioner')?.addEventListener('click', () => { closeMemberModal(); document.querySelector('#commissioner')?.scrollIntoView({ behavior: 'smooth' }); });
  const pendingClaimId = memberSessionData?.claim?.id;
  body.querySelector('#cancelTeamClaim')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    try { await memberRequest('POST', { action: 'cancel_claim', claim_id: pendingClaimId }); await refreshMemberState(); }
    catch (error) { showToast(memberErrorText(error.message)); }
    finally { button.disabled = false; }
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
  const canChoose = Boolean(authSession && memberSessionData?.membership?.fantasy_team_id &&
    memberSessionData?.eligible_weekly_winner && memberSessionData?.submission_window_open &&
    (!memberSessionData?.current_proposal || memberSessionData.current_proposal.status === 'REJECTED'));
  document.querySelector('.weekly-winner')?.classList.toggle('hidden', !canChoose);
  document.querySelector('.hero-grid')?.classList.toggle('bank-only', !canChoose);
  replaceSubmitHandler();
  const button = document.querySelector('#submitButton');
  if (!button) return;
  button.disabled = false;
  if (!authSession) button.textContent = 'Sign in to submit';
  else if (!memberSessionData?.membership?.fantasy_team_id) button.textContent = 'Claim team to submit';
  else if (['SUBMITTED', 'AWAITING_COMMISSIONER_PLACEMENT', 'PLACED'].includes(memberSessionData?.current_proposal?.status)) { button.textContent = 'Ticket submitted ✓'; button.disabled = true; }
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
    award_id: memberSessionData.current_award?.id,
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
  const fingerprint = JSON.stringify({ user: authSession.user.id, award: payload.award_id, choice: payload.choice,
    legs: payload.legs.map(({ event_id, odd_id, sport, odds, line }) => ({ event_id, odd_id, sport, odds, line })) });
  if (pendingWeeklySubmission?.fingerprint !== fingerprint) pendingWeeklySubmission = { fingerprint, key: crypto.randomUUID() };
  payload.request_id = pendingWeeklySubmission.key;
  const button = document.querySelector('#submitButton');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Validating live ticket…';
  try {
    const result = await memberRequest('POST', payload);
    pendingWeeklySubmission = null;
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

function providerBudgetMarkup() {
  const b=commissionerData?.provider_budget, p=b?.policy;
  if(!p) return '';
  const usd=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:4}).format(Number(v||0)/1000000);
  const fields=[['daily_request_limit','Daily request cap'],['monthly_request_limit','Monthly request cap'],
    ['per_user_daily_limit','Daily cap per owner'],['daily_budget_microusd','Daily budget ($)'],
    ['monthly_budget_microusd','Monthly budget ($)'],['max_request_cost_microusd','Worst-case cost per request ($)']];
  return `<article class="commissioner-persistent-item">
    <h3>Provider spending · ${p.enabled?'Enabled':'Paused'}</h3>
    ${p.prepaid_subscription?'<p>SportsGameOdds is covered by the existing subscription. Additional spend is capped at $0; object and request limits still apply.</p>':''}
    <p>Today: ${Number(b.day_requests)} / ${Number(p.daily_request_limit)} requests · ${usd(b.day_reserved_microusd)} reserved of ${usd(p.daily_budget_microusd)}.
    Month: ${Number(b.month_requests)} / ${Number(p.monthly_request_limit)} requests · ${usd(b.month_reserved_microusd)} reserved of ${usd(p.monthly_budget_microusd)}.</p>
    <p>Reserved amounts are conservative estimates, not confirmed charges. Failed calls stay counted. Limits reset at midnight UTC. Hosted intelligence remains disabled.</p>
    <div class="placement-form">${fields.map(([key,label])=>`<label>${label}<input class="commissioner-input" id="budget-${key}" type="number" min="0" step="${key.endsWith('microusd')?'0.000001':'1'}" value="${Number(p[key])/(key.endsWith('microusd')?1000000:1)}"></label>`).join('')}</div>
    <p>Set the worst-case cost to cover a provider request returning up to 40 events. Verify it against your provider plan before enabling. No automated billing reconciliation is available yet.</p>
    <label><input id="budget-enabled" type="checkbox" ${p.enabled?'checked':''}> Enable paid odds refreshes within these limits</label>
    <div class="commissioner-actions"><button class="commissioner-action primary" data-save-budget>Save limits</button>
    <button class="commissioner-action danger" data-pause-budget>Pause paid calls</button>
    <button class="commissioner-action" data-refresh-snapshots>Refresh market snapshots</button></div>
  </article>`;
}

function integrationBudgetMarkup(){
  const budget=commissionerData?.integration_budget, policy=commissionerData?.analysis_policy;
  if(!budget || !policy)return '';
  const objects=commissionerData?.object_budget,tracker=commissionerData?.tracker_policy;
  const objectMarkup=objects?`<h3>SportsGameOdds object usage</h3><p>Account: ${Number(objects.policy.reported_used).toLocaleString()} / ${Number(objects.policy.reported_limit).toLocaleString()} reported objects. Checked ${objects.policy.reported_at?escapeMemberText(new Date(objects.policy.reported_at).toLocaleString()):'never'}. Local calendar-month usage, including uncertain reservations: ${Number(objects.local_month_objects).toLocaleString()}.</p><p>Usage must be checked within 24 hours before fresh requests. Other apps using this API key can also consume its allowance.</p><button class="commissioner-action" data-refresh-usage>Check provider usage</button><label>Local monthly object ceiling (0 pauses requests)<input id="objectLimit" class="commissioner-input" type="number" min="0" max="100000" step="1" value="${Number(objects.policy.monthly_limit)}"></label><button class="commissioner-action" data-save-object-limit>Save object ceiling</button>`:'';
  const trackerMarkup=tracker?`<h3>Shared weekly tracker</h3><p>${tracker.enabled?'Enabled':'Paused'} · one refresh every three minutes for active placed-ticket games. Latest attempt: ${tracker.last_attempt_at?escapeMemberText(new Date(tracker.last_attempt_at).toLocaleString()):'none'}. ${tracker.last_error?'Last refresh failed; previous data retained.':''}</p><button class="commissioner-action" data-toggle-tracker>${tracker.enabled?'Pause':'Enable'} tracker updates</button>`:'';
  return `<article class="commissioner-persistent-item">${objectMarkup}${trackerMarkup}<h3>Overall integration budget</h3>
    <p>This ceiling and the provider-specific limits both apply. Amounts reserve worst-case costs, not billed totals.</p>
    <label>Daily ceiling ($) <input id="integrationDaily" class="commissioner-input" type="number" min="0" step="0.01" value="${Number(budget.daily_microusd)/1000000}"></label>
    <label>Monthly ceiling ($) <input id="integrationMonthly" class="commissioner-input" type="number" min="0" step="0.01" value="${Number(budget.monthly_microusd)/1000000}"></label>
    <label><input id="integrationEnabled" type="checkbox" ${budget.enabled?'checked':''}> Allow new paid reservations</label>
    <button class="commissioner-action" data-save-integrations>Save overall budget</button>
    <p>Weekly analysis: ${policy.enabled?'Enabled':'Paused'} · five fresh attempts per winner · no cooldown. Fresh data is shared for three minutes. Cached views do not consume an attempt; failed attempts can count.</p>
    <button class="commissioner-action" data-toggle-analysis>${policy.enabled?'Pause':'Enable'} weekly analysis</button></article>`;
}

function ownerInvitationMarkup(){
  const owners=commissionerData?.owners||[],enabled=commissionerData?.invitations_enabled;
  if(!owners.length)return '';
  return '<div class="commissioner-section-title">League invitations</div><p>'+
    (enabled?'Send each owner a one-time link to choose their password.':'Email delivery setup is pending. Invitations are disabled until the sender is configured.')+
    '</p>'+owners.map(owner=>`<article class="commissioner-persistent-item">
      <h3>${escapeMemberText(owner.manager_name)} · ESPN team ${escapeMemberText(owner.fantasy_team_id)}</h3>
      <p>${escapeMemberText(owner.email)} · ${escapeMemberText(owner.invite_status)}</p>
      <button class="commissioner-action" data-invite-owner="${escapeMemberText(owner.id)}" ${!enabled||!['NOT_SENT','FAILED'].includes(owner.invite_status)?'disabled':''}>Send invitation</button>
    </article>`).join('');
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

  let html = integrationBudgetMarkup() + ownerInvitationMarkup();
  if (pendingClaims.length) {
    html += '<div class="commissioner-section-title">Pending team claims</div>' + pendingClaims.map((claim) => `
      <article class="commissioner-persistent-item">
        <h3>${escapeMemberText(claim.fantasy_team_name)}</h3><p>${escapeMemberText(claim.display_name)} requested ESPN team ${escapeMemberText(claim.fantasy_team_id)}</p>
        <div class="commissioner-actions"><button class="commissioner-action primary" data-approve-claim="${claim.id}">Approve</button><button class="commissioner-action danger" data-reject-claim="${claim.id}">Reject</button></div>
      </article>`).join('');
  }
  if (pendingProposals.length) {
    html += '<div class="commissioner-section-title">Awaiting DraftKings placement</div>' + pendingProposals.map((proposal) => `
      <article class="commissioner-persistent-item">
        <h3>${escapeMemberText(proposal.submitter?.fantasy_team_name || proposal.submitter?.display_name || 'Weekly winner')} · ${commissionerMoney(proposal.proposed_stake_cents)}</h3>
        <p>${proposal.legs?.length || 0}-leg ticket · submitted ${proposal.submitted_at ? new Date(proposal.submitted_at).toLocaleString() : '—'} · estimated ${proposal.estimated_american_odds ? formatOdds(proposal.estimated_american_odds) : 'price unavailable'}</p>
        <ul class="commissioner-leg-list">${(proposal.legs || []).map((leg) => `<li>${escapeMemberText(leg.selection)} · ${formatOdds(leg.american_odds)}</li>`).join('')}</ul>
        ${new Set((proposal.legs || []).map(leg=>leg.event_id)).size < (proposal.legs || []).length ? '<p class="warning">Same-game ticket: the estimate does not account for related outcomes. Verify the exact combination in DraftKings and enter its actual combined odds below. Reject the ticket if DraftKings does not accept the combination.</p>' : ''}
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
      <article class="commissioner-persistent-item"><h3>${escapeMemberText(bet.category)} · ${formatOdds(bet.placed_american_odds)} · ${commissionerMoney(bet.stake_cents)}</h3><p>Potential return ${commissionerMoney(bet.potential_return_cents)}${bet.sportsbook_ticket_ref ? ` · DK ref ${escapeMemberText(bet.sportsbook_ticket_ref)}` : ''}</p><div class="commissioner-actions"><button class="commissioner-action primary" data-settle-win="${bet.id}" data-return="${bet.potential_return_cents}">Won</button><button class="commissioner-action danger" data-settle-loss="${bet.id}">Lost</button><button class="commissioner-action" data-settle-push="${bet.id}" data-return="${bet.stake_cents}">Push/Void</button></div></article>`).join('');
  }
  if (!html) html = '<div class="empty-state"><div class="empty-icon">✓</div><p>No team claims, ticket placements, or open bets need commissioner action.</p></div>';
  queue.innerHTML = '<div class="commissioner-actions"><button class="commissioner-action" data-refresh-standings>Refresh ESPN leaderboard</button></div>' + (typeof commissionerEditionMarkup==='function'?commissionerEditionMarkup(commissionerData):'') + providerBudgetMarkup() + html;
  bindCommissionerActions();
}

function bindCommissionerActions() {
  function bind(selector, action) {
    document.querySelectorAll(selector).forEach((button) => button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        const completed = await action(button);
        if (completed !== false) {
          await loadCommissionerConsole();
          await loadLiveLeagueBank();
        }
      } catch (error) {
        showToast(memberErrorText(error.message));
      } finally {
        button.disabled = false;
      }
    }));
  }
  bind('[data-refresh-usage]',async()=>{await commissionerRequest('POST',{action:'refresh_usage'});showToast('Provider usage updated.');});
  bind('[data-save-object-limit]',async()=>{
    const value=document.getElementById('objectLimit').value;
    if(!value.trim() || !Number.isInteger(Number(value)) || Number(value)<0 || Number(value)>100000)throw new Error('Enter an object ceiling from 0 to 100000');
    await commissionerRequest('POST',{action:'set_object_limit',limit:Number(value)});showToast('Object ceiling saved.');
  });
  bind('[data-toggle-tracker]',async()=>{
    const enabled=!commissionerData.tracker_policy.enabled;
    if(enabled && !window.confirm('Enable shared score refreshes for placed weekly tickets? All provider and object budgets still apply.'))return false;
    await commissionerRequest('POST',{action:'set_tracker_enabled',enabled});showToast(enabled?'Tracker updates enabled.':'Tracker updates paused.');
  });
  bind('[data-invite-owner]', async button=>{
    const result=await commissionerRequest('POST',{action:'invite_owner',owner_id:button.dataset.inviteOwner});
    showToast(result.skipped?'This invitation was already sent.':'Invitation submitted for email delivery.');
  });
  bind('[data-save-integrations]',async()=>{
    const daily=document.getElementById('integrationDaily').value,monthly=document.getElementById('integrationMonthly').value;
    if(!daily.trim() || !monthly.trim())throw new Error('Enter both budget amounts');
    const policy={enabled:document.getElementById('integrationEnabled').checked,daily_microusd:Math.round(Number(daily)*1000000),monthly_microusd:Math.round(Number(monthly)*1000000)};
    if(!window.confirm('Save the overall integration budget'+(policy.enabled?' and allow budgeted provider calls?':' with new paid calls paused?')))return false;
    await commissionerRequest('POST',{action:'set_integration_budget',policy});showToast('Overall budget saved.');
  });
  bind('[data-toggle-analysis]',async()=>{
    const enabled=!commissionerData.analysis_policy.enabled;
    if(enabled && !window.confirm('Enable five fresh analysis attempts for the weekly winner? Overall and provider budgets still apply.'))return false;
    await commissionerRequest('POST',{action:'set_analysis_enabled',enabled});showToast(enabled?'Weekly analysis enabled.':'Weekly analysis paused.');
  });
  bind('[data-create-edition]', async()=>{
    await commissionerRequest('POST',{action:'create_edition',week:Number(document.querySelector('#editionWeek').value)});
    showToast('Private recap draft ready for review.');
  });
  for(const kind of ['save','publish'])bind('[data-'+kind+'-edition]',async button=>{
    const id=button.dataset[kind+'Edition'];const edition=commissionerData.editions.find(e=>e.id===id);
    const entries=Array.from(document.querySelectorAll('[data-edition]')).filter(el=>el.dataset.edition===id)
      .map(el=>({team_id:el.dataset.editionTeam,prose:el.value}));
    await commissionerRequest('POST',{action:kind+'_edition',edition_id:id,version:edition.version,entries});
    showToast(kind==='publish'?'Weekly edition published.':'Draft saved privately.');
  });
  bind('[data-save-budget]', async () => {
    const policy={enabled:document.querySelector('#budget-enabled').checked};
    for(const key of ['daily_request_limit','monthly_request_limit','per_user_daily_limit','daily_budget_microusd','monthly_budget_microusd','max_request_cost_microusd']){
      const value=Number(document.querySelector('#budget-'+key).value);
      policy[key]=key.endsWith('microusd')?Math.round(value*1000000):value;
    }
    if(!window.confirm('Save these provider spending limits'+(policy.enabled?' and enable paid odds refreshes?':' with paid refreshes paused?'))) return false;
    await commissionerRequest('POST',{action:'set_provider_budget',policy});
    showToast('Provider spending limits saved.');
  });
  bind('[data-pause-budget]', async () => {
    await commissionerRequest('POST',{action:'pause_provider_calls'});
    showToast('New paid provider calls are paused.');
  });
  bind('[data-refresh-snapshots]', async () => { await loadLiveDraftKingsMarkets(); });
  bind('[data-refresh-standings]', async () => {
    const result = await commissionerRequest('POST', {action:'refresh_league_standings'});
    showToast(result.skipped ? 'ESPN refresh is limited to once every 15 minutes.' : 'ESPN standings refreshed.');
  });
  bind('[data-approve-claim]', async (button) => {
    if (!window.confirm('Approve this fantasy-team claim?')) return false;
    await commissionerRequest('POST', { action: 'approve_claim', claim_id: button.dataset.approveClaim });
    showToast('Team claim approved.');
  });
  bind('[data-reject-claim]', async (button) => {
    if (!window.confirm('Reject this fantasy-team claim?')) return false;
    await commissionerRequest('POST', { action: 'reject_claim', claim_id: button.dataset.rejectClaim });
    showToast('Team claim rejected.');
  });
  bind('[data-reject-proposal]', async (button) => {
    if (!window.confirm('Reject this submitted ticket?')) return false;
    await commissionerRequest('POST', { action: 'reject_proposal', proposal_id: button.dataset.rejectProposal });
    showToast('Ticket rejected.');
  });
  bind('[data-place-proposal]', async (button) => {
    const id = button.dataset.placeProposal;
    const odds = document.querySelector('#actualOdds-' + CSS.escape(id))?.value?.trim();
    const ticketRef = document.querySelector('#ticketRef-' + CSS.escape(id))?.value?.trim();
    if (!odds) { showToast('Enter the actual combined DraftKings odds first.'); return false; }
    if (!window.confirm('Confirm DraftKings accepted every selection exactly as submitted and you placed the ticket at actual combined odds ' + odds + '? These actual odds determine the official total return, including the stake.')) return false;
    await commissionerRequest('POST', { action: 'confirm_placement', proposal_id: id, placed_american_odds: odds, sportsbook_ticket_ref: ticketRef || null });
    showToast('DraftKings placement recorded.');
  });
  for (const [selector, key, status, message] of [
    ['[data-settle-win]', 'settleWin', 'WON', 'Winning return credited to the Bonus Bank.'],
    ['[data-settle-loss]', 'settleLoss', 'LOST', 'Ticket settled as lost.'],
    ['[data-settle-push]', 'settlePush', 'PUSHED', 'Returned stake recorded.'],
  ]) {
    bind(selector, async (button) => {
      if (!window.confirm('Settle this ticket as ' + status + '?')) return false;
      await commissionerRequest('POST', { action: 'settle_bet', bet_id: button.dataset[key], status, settlement_return_cents: status === 'LOST' ? 0 : Number(button.dataset.return) });
      showToast(message);
    });
  }
}

createMemberUi();
replaceSubmitHandler();
authClient.auth.onAuthStateChange((event,session) => {
  if(event==='PASSWORD_RECOVERY')passwordMode='recovery';
  if(event==='SIGNED_IN' && incomingAuthType==='invite'){passwordMode='setup';incomingAuthType=null;}
  if(event==='SIGNED_OUT'){passwordMode=null;incomingAuthType=null;}
  window.setTimeout(async()=>{
    await refreshMemberState();
    if(passwordMode && authSession)openMemberModal();
  },0);
});
refreshMemberState();
