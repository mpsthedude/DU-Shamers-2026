const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('placement accepts form odds and rejects malformed or invalid odds', () => {
  const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/commissioner-api/index.ts'), 'utf8');
  const fn = source.slice(source.indexOf('function american('), source.indexOf('async function context('))
    .replace('value: unknown', 'value').replace('): number | null', ')');
  const parse = vm.runInNewContext(fn + '\namerican');
  for (const [input, expected] of [['+150', 150], ['-110', -110], ['100', 100], [' +125 ', 125], [150, 150]]) {
    assert.equal(parse(input), expected);
  }
  for (const input of ['', null, true, '1e3', '150.5', '150junk', 50, '-99', Infinity]) {
    assert.equal(parse(input), null);
  }
});
