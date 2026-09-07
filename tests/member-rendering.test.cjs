const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('account and commissioner renderers escape stored names and ticket references', () => {
  const elements = new Map();
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '',
      classList: { add() {}, remove() {} }, querySelector() { return null; }, querySelectorAll() { return []; } });
    return elements.get(selector);
  };
  const ctx = vm.createContext({ Intl, Date, console, URLSearchParams, LIVE_API_ROOT: 'https://example.invalid', LIVE_PUBLISHABLE_KEY: 'fixture',
    window: { location: { hash: '' }, supabase: { createClient() { return {}; } } },
    document: { querySelector: get, querySelectorAll() { return []; } },
    formatOdds: String,
  });
  const code = fs.readFileSync(path.join(__dirname, '../auth.js'), 'utf8');
  vm.runInContext(code.slice(0, code.lastIndexOf('\ncreateMemberUi();')), ctx);
  vm.runInContext(`
    authSession = { user: { email: '<img src=x onerror=alert(1)>' } };
    memberSessionData = { membership: { fantasy_team_name: '<script>bad()</script>', fantasy_team_id: '1', role: 'OWNER' } };
    renderMemberModal();
    commissionerData = {
      claims: [{ id: '1', status: 'PENDING', display_name: '<img onerror=bad()>', fantasy_team_name: '<script>bad()</script>', fantasy_team_id: '1' }],
      proposals: [{ id: '2', status: 'AWAITING_COMMISSIONER_PLACEMENT', proposed_stake_cents: 5000, submitter: {display_name: '<img src=x>'}, legs: [{selection: '<img onerror=bad()>', american_odds: 100}] }],
      bets: [{ id: '3', status: 'OPEN', category: 'WEEKLY', sportsbook_ticket_ref: '<img src=x>', placed_american_odds: 100, stake_cents: 5000, potential_return_cents: 10000 }]
    };
    renderCommissionerConsole();
  `, ctx);
  for (const selector of ['#memberModalBody', '#commissionerQueue']) {
    const html = get(selector).innerHTML;
    assert.doesNotMatch(html, /<script>|<img/);
    assert.match(html, /&lt;/);
  }
  assert.equal(ctx.escapeMemberText('"\'&<>'), '&quot;&#39;&amp;&lt;&gt;');
});
