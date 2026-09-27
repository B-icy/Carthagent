// Evaluator-owned public-boundary checks. Never imported by candidate source.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const load = path => import(pathToFileURL(resolve(path)).href);
const { totalAmounts } = await load('packages/money/index.mjs');
const { handleSummary } = await load('packages/api/index.mjs');
const { exportCsv } = await load('packages/csv/index.mjs');
const failures = [];
function probe(name, fn) { try { fn(); console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); } }
probe('exact mixed input total', () => assert.equal(totalAmounts(['0.10', 0.2, '-0.05']), 0.25));
probe('repeated decimal additions', () => assert.equal(totalAmounts(Array(100).fill('0.01')), 1));
probe('public API retains numeric total and adds canonical decimal total', () => assert.deepEqual(handleSummary({ entries: [{ amount: '0.10' }, { amount: '0.20' }] }), { status: 200, body: { count: 2, total: 0.3, totalDecimal: '0.30' } }));
probe('empty and refund behavior', () => {
  assert.equal(handleSummary({ entries: [] }).body.totalDecimal, '0.00');
  assert.equal(handleSummary({ entries: [{ amount: '-1.05' }] }).body.totalDecimal, '-1.05');
});
probe('reject invalid money without throwing through API boundary', () => {
  for (const amount of ['', ' ', '1e2', '0x10', 'NaN', '1.001', null, true, {}, [], Infinity, NaN]) {
    const response = handleSummary({ entries: [{ amount }] });
    assert.equal(response.status, 400, `accepted ${JSON.stringify(amount)}`);
    assert.equal(typeof response.body.error, 'string');
    assert.throws(() => totalAmounts([amount]));
  }
  for (const entry of [null, {}, 'bad']) assert.equal(handleSummary({ entries: [entry] }).status, 400);
});
probe('safe-integer-cent overflow rejected', () => assert.equal(handleSummary({ entries: [{ amount: '90071992547409.92' }] }).status, 400));
probe('CSV compatibility and validation', () => {
  assert.equal(exportCsv([{ id: 'café', amount: '0.10' }, { id: 'refund', amount: '-1.05' }]), 'id,amount\ncafé,0.10\nrefund,-1.05\n');
  assert.throws(() => exportCsv([{ id: 'bad', amount: '1.001' }]));
});
probe('actual CLI with Unicode/spaced file paths and invalid input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'billing café '));
  try {
    const path = join(dir, 'input with spaces.json');
    writeFileSync(path, JSON.stringify({ entries: [{ amount: '0.1' }, { amount: 0.2 }] }));
    const valid = spawnSync(process.execPath, ['packages/cli/main.mjs', path], { encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).totalDecimal, '0.30');
    writeFileSync(path, JSON.stringify({ entries: [{ amount: 'oops' }] }));
    const invalid = spawnSync(process.execPath, ['packages/cli/main.mjs', path], { encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.equal(typeof JSON.parse(invalid.stdout).error, 'string');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
if (process.argv[2] === 'followup') {
  probe('rounding compatibility: numeric floating-point noise accepted, real third decimal rejected', () => {
    assert.equal(handleSummary({ entries: [{ amount: 0.1 + 0.2 }] }).body.totalDecimal, '0.30');
    assert.equal(handleSummary({ entries: [{ amount: 1.005 }] }).status, 400);
    assert.equal(handleSummary({ entries: [{ amount: '0.30000000000000004' }] }).status, 400);
    assert.equal(exportCsv([{ id: 'old-client', amount: 0.1 + 0.2 }]), 'id,amount\nold-client,0.30\n');
  });
}
console.log(JSON.stringify({ probesFailed: failures, mode: process.argv[2] || 'base' }));
if (failures.length) process.exitCode = 1;
