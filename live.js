const LIVE_API_URL = 'https://xvnkwtiydyrksucgiphi.supabase.co/functions/v1/league-dashboard';
const LIVE_ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2bmt3dGl5ZHlya3N1Y2dpcGhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzODA2NjgsImV4cCI6MjEwMzk1NjY2OH0.IZ3-e62sZjfhvxYLNjGg9B1EHeeDh7qzqgjjFIyWk3k';

function centsToMoney(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
}

function shortDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(date);
}

function accountLabel(value) {
  const map = {
    GENERAL_POOL: 'General pool',
    PRIZE_RESERVE: 'Prize reserve',
    FUTURES_ALLOCATION: 'Futures',
    WEEKLY_ALLOCATION: 'Weekly program',
    BONUS_BANK: 'Bonus bank',
    CASH_PAYOUTS: 'Cash payouts',
  };
  return map[value] || value || '—';
}

function applyLiveAward(award) {
  if (!award) return;
  const winnerName = document.querySelector('#winnerName');
  const winnerScore = document.querySelector('#winnerScore');
  const label = document.querySelector('.weekly-winner .muted');
  const note = document.querySelector('.weekly-winner .tiny-note');

  if (label) label.textContent = `Week ${award.week} high scorer`;

  if (award.source_status === 'WINNER_IDENTIFIED' && award.fantasy_team_name) {
    if (winnerName) winnerName.textContent = award.fantasy_team_name;
    if (winnerScore) winnerScore.textContent = Number(award.score || 0).toFixed(2);
    if (note) note.textContent = `Live ESPN result synced to the league bank${award.identified_at ? ` on ${new Date(award.identified_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}` : ''}.`;
    return;
  }

  if (award.source_status === 'COMMISSIONER_RESOLUTION_REQUIRED') {
    if (winnerName) winnerName.textContent = 'Tie — commissioner resolution required';
    if (winnerScore) winnerScore.textContent = Number(award.score || 0).toFixed(2);
    if (note) note.textContent = 'The system detected a high-score tie. Commissioner handling remains intentionally manual.';
    return;
  }

  if (winnerName) winnerName.textContent = 'Awaiting Week 1 results';
  if (winnerScore) winnerScore.textContent = '0.00';
  if (note) note.textContent = 'The live backend is connected. Tuesday winner sync will populate this card after the scoring week is complete.';
}

function applyLiveLedger(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const tbody = document.querySelector('#ledgerRows');
  if (!tbody) return;
  tbody.innerHTML = rows.map((item) => {
    const amount = Number(item.amount_cents || 0) / 100;
    return `
      <tr>
        <td>${shortDate(item.occurred_at)}</td>
        <td>${item.description || item.transaction_type || 'Transaction'}</td>
        <td>${accountLabel(item.account)}</td>
        <td class="${amount >= 0 ? 'amount-credit' : 'amount-debit'}">${amount >= 0 ? '+' : '−'}${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(amount))}</td>
      </tr>`;
  }).join('');
}

function applyLiveStatus(data) {
  const badges = [...document.querySelectorAll('.topbar .status-pill')];
  const dataBadge = badges.find((el) => el.classList.contains('demo'));
  if (dataBadge) {
    dataBadge.classList.remove('demo');
    dataBadge.innerHTML = '<span class="dot"></span> Live league bank';
    dataBadge.style.color = 'var(--accent-2)';
  }

  const bonus = document.querySelector('#bonusBank');
  if (bonus) bonus.textContent = centsToMoney(data.bonus_bank_cents || 0);

  applyLiveAward(data.current_award);
  applyLiveLedger(data.ledger);
}

async function loadLiveLeagueBank() {
  try {
    const response = await fetch(LIVE_API_URL, {
      method: 'GET',
      headers: {
        apikey: LIVE_ANON_JWT,
        Authorization: `Bearer ${LIVE_ANON_JWT}`,
      },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`league-dashboard ${response.status}`);
    const data = await response.json();
    applyLiveStatus(data);
  } catch (error) {
    console.warn('Live league bank unavailable; retaining demo shell.', error);
  }
}

window.addEventListener('DOMContentLoaded', loadLiveLeagueBank);
