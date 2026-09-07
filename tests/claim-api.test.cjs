const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const actor = '11111111-1111-4111-8111-111111111111';
const league = '22222222-2222-4222-8222-222222222222';
const claim = '33333333-3333-4333-8333-333333333333';

function harness(slug, isCommissioner = false, rpcError = null) {
  let handler;
  const calls = [];
  const db = { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: { ok: true }, error: rpcError };
  } };
  const ctx = vm.createContext({ Response, Request, URL, URLSearchParams, console: { error() {} },
    createClient: () => ({}), Deno: { env: { get: () => 'fixture' }, serve: fn => { handler = fn; } } });
  const source = fs.readFileSync(path.join(__dirname, '../supabase/functions', slug, 'index.ts'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  vm.runInContext(stripTypeScriptTypes(source), ctx);
  const realHandler = handler;
  const post = body => realHandler(new Request('https://example.invalid', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  const publicRequest = () => realHandler(new Request('https://example.invalid', {
    headers: { Authorization: 'Bearer sb_publishable_fixture' },
  }));
  return { calls, post, publicRequest, authorize() {
    ctx.authenticatedContext = ctx.context = async () => ({ db, user: { id: actor }, league: { id: league },
      membership: { id: actor, role: 'COMMISSIONER' }, isCommissioner, season: { id: league } });
    ctx.espnTeams = async () => [{ team_id: '1', team_name: 'Verified ESPN Team' }];
  } };
}

test('claim request uses verified ESPN name and current commissioner authorization', async () => {
  for (const allowed of [false, true]) {
    const h = harness('member-api', allowed); h.authorize();
    const response = await h.post({ action: 'claim_team', fantasy_team_id: '1', fantasy_team_name: 'Forged', p_actor: 'Forged' });
    assert.equal(response.status, 200);
    assert.equal(h.calls[0].args.p_action, allowed ? 'SELF_ASSIGN' : 'REQUEST');
    assert.equal(h.calls[0].args.p_actor, actor);
    assert.equal(h.calls[0].args.p_team_name, 'Verified ESPN Team');
  }
});

test('cancellation requires and forwards a specific claim ID', async () => {
  const h = harness('member-api'); h.authorize();
  assert.equal((await h.post({ action: 'cancel_claim' })).status, 400);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.post({ action: 'cancel_claim', claim_id: claim })).status, 200);
  assert.equal(h.calls[0].args.p_claim, claim);
  assert.equal(h.calls[0].args.p_action, 'CANCEL');
});

test('claim review maps actions and reports transaction conflicts without exposing database details', async () => {
  for (const action of ['approve_claim', 'reject_claim']) {
    const h = harness('commissioner-api'); h.authorize();
    assert.equal((await h.post({ action, claim_id: claim })).status, 200);
    assert.equal(h.calls[0].args.p_action, action === 'approve_claim' ? 'APPROVE' : 'REJECT');
  }
  for (const [error, status, message] of [
    [{ message: 'claim_already_resolved', code: 'P0001' }, 409, 'claim_already_resolved'],
    [{ message: 'private database details', code: 'XX000' }, 500, 'claim_transaction_failed'],
  ]) {
    const h = harness('commissioner-api', true, error); h.authorize();
    const r = await h.post({ action: 'approve_claim', claim_id: claim });
    assert.equal(r.status, status);
    assert.equal((await r.json()).error, message);
  }
});

test('both deployed handlers reject public-key requests before claim actions', async () => {
  for (const slug of ['member-api', 'commissioner-api']) {
    const h = harness(slug);
    assert.equal((await h.publicRequest()).status, 401);
    assert.equal(h.calls.length, 0);
  }
});
