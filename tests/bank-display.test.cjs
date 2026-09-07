const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
  const nodes = new Map();
  function element() {
    return { textContent: '', innerHTML: '', style: {}, children: [],
      classList: { add() {}, remove() {} },
      replaceChildren() { this.children = []; this.innerHTML = ''; },
      append(child) { this.children.push(child); } };
  }
  function get(key) { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key); }
  const context = vm.createContext({ Intl, Date, console: { warn() {} },
    document: { querySelector: get, getElementById: id => get(`#${id}`), createElement: element },
    window: { addEventListener() {} },
    fetch: async () => ({ ok: false, status: 503 }),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../live.js'), 'utf8'), context);
  return { context, get };
}

test('bank uses server amounts, clears an empty ledger and shows missing values as unavailable', () => {
  const { context, get } = harness();
  get('#ledgerRows').innerHTML = 'old transactions';
  context.applyLiveStatus({ bonus_bank_cents: -2500, ledger: [], current_award: null,
    season: { weekly_remaining_cents: 130000, futures_remaining_cents: 40000, cash_payouts_cents: 5000, weekly_spent_cents: 5000 } });
  assert.equal(get('#bonusBank').textContent, '-$25.00');
  assert.equal(get('#weeklyRemaining').textContent, '$1,300.00');
  assert.equal(get('#cashPaid').textContent, '$50.00');
  assert.equal(get('#ledgerRows').innerHTML, '');
  assert.equal(get('#ledgerRows').children[0].children[0].textContent, 'No transactions recorded yet.');
  assert.equal(get('#winnerName').textContent, 'Awaiting finalized results');
  context.applyLiveStatus({ ledger: [], season: {} });
  assert.equal(get('#weeklyRemaining').textContent, '—');
});

test('ledger descriptions are text, not executable HTML', () => {
  const { context, get } = harness();
  const description = '<img src=x onerror=alert(1)>';
  context.applyLiveLedger([{ description, account: 'BONUS_BANK', amount_cents: 12500, occurred_at: '2026-09-07T12:00:00Z' }]);
  const cells = get('#ledgerRows').children[0].children;
  assert.equal(cells[1].textContent, description);
  assert.equal(cells[1].innerHTML, '');
  assert.equal(cells[3].textContent, '+$125.00');
});

test('an outage clears old financial and winner values and a later success recovers', async () => {
  const { context, get } = harness();
  get('#bonusBank').textContent = '$500.00';
  await context.loadLiveLeagueBank();
  assert.equal(get('#bankDataStatus').textContent, 'League bank unavailable');
  assert.equal(get('#bonusBank').textContent, '—');
  assert.equal(get('#winnerName').textContent, 'Winner data unavailable');
  assert.match(get('#ledgerRows').innerHTML, /unavailable/);
  context.fetch = async () => ({ ok: true, json: async () => ({ bonus_bank_cents: 0, season: { weekly_remaining_cents: 140000 }, ledger: [], current_award: null }) });
  await context.loadLiveLeagueBank();
  assert.equal(get('#bonusBank').textContent, '$0.00');
  assert.equal(get('#weeklyRemaining').textContent, '$1,400.00');
  assert.match(get('#bankDataStatus').innerHTML, /Live league bank/);
});
