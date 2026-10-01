// Shared application shell, separate public and role-specific page URLs.
const hubPage = location.pathname.endsWith('/commissioner.html') ? 'commissioner' : location.pathname.endsWith('/my-bet.html') ? 'bet' : 'home';
document.documentElement.dataset.page = hubPage;
if (hubPage === 'home' && location.hash === '#commissioner') location.replace('commissioner.html');
function updatePageAccess(canChoose, member, session) {
  document.documentElement.dataset.canBet = String(canChoose);
  const isCommissioner = member?.membership?.role === 'COMMISSIONER';
  document.querySelectorAll('[data-commissioner-link]').forEach(el => el.hidden = !isCommissioner);
  document.querySelectorAll('[data-bettor-link]').forEach(el => el.hidden = !member?.eligible_weekly_winner);
  const gate = document.getElementById('pageAccess');
  if (!gate || hubPage === 'home') return;
  gate.hidden = hubPage === 'commissioner' ? isCommissioner : canChoose;
  document.getElementById('pageAccessMessage').textContent = !session ? 'Sign in with your league account to continue.' : hubPage === 'commissioner' ? 'Commissioner access is required for this page.' : member?.current_proposal && member.current_proposal.status !== 'REJECTED' ? 'Your ticket has been submitted. Its status and selections are available in your league account. The commissioner will confirm placement.' : 'Ticket building is available to this week’s eligible bettor while the submission window is open.';
}
document.addEventListener('DOMContentLoaded', () => {
  document.querySelector('#pageSignIn')?.addEventListener('click', () => document.querySelector('#memberAccessButton')?.click());
  if(hubPage !== 'home') {
    document.title = (hubPage === 'commissioner' ? 'Commissioner' : 'My Weekly Bet') + ' · DU Shamers';
    document.querySelector('h1').textContent = hubPage === 'commissioner' ? 'Commissioner' : 'My Weekly Bet';
  }
  // Put the league story first; financial details remain available below it.
  const main = document.querySelector('main');
  if(hubPage === 'home') {
    for(const selector of ['#overview','#weeklyBettorAnnouncement','#bettorEntry','#weeklyTracker','#leagueStandings','#weeklyEdition','.hero-grid','.stats-grid','#futures','#settledTicketRecap','.ledger-layout']) {
      const el=document.querySelector(selector);if(el) main.append(el);
    }
  }
});
