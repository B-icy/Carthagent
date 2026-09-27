import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const { handleSummary } = await import(pathToFileURL(resolve('packages/api/index.mjs')));
const { totalAmounts } = await import(pathToFileURL(resolve('packages/money/index.mjs')));
const failures = [];
function probe(name, fn) { try { fn(); console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); } }
const permutations = [
  ['90071992547409.91', '0.01', '-0.01'],
  ['0.01', '-0.01', '90071992547409.91'],
  ['-0.01', '90071992547409.91', '0.01'],
  ['-90071992547409.91', '-0.01', '0.01'],
];
probe('order-independent safe final reconciliation totals', () => {
  for (const amounts of permutations) {
    const result = handleSummary({ entries: amounts.map(amount => ({ amount })) });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.body.totalDecimal, amounts.includes('-90071992547409.91') ? '-90071992547409.91' : '90071992547409.91');
    assert.equal(typeof totalAmounts(amounts), 'number');
  }
});
probe('unsafe final totals and unsafe individual entries still rejected', () => {
  for (const amounts of [['90071992547409.91', '0.01'], ['-90071992547409.91', '-0.01'], ['90071992547409.92', '-0.01']]) {
    assert.equal(handleSummary({ entries: amounts.map(amount => ({ amount })) }).status, 400);
    assert.throws(() => totalAmounts(amounts));
  }
});
probe('CLI serializes exact final decimal through public boundary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reconciliation café '));
  try {
    const path = join(dir, 'batch input.json');
    writeFileSync(path, JSON.stringify({ entries: permutations[0].map(amount => ({ amount })) }));
    const result = spawnSync(process.execPath, ['packages/cli/main.mjs', path], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).totalDecimal, '90071992547409.91');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
console.log(JSON.stringify({ probesFailed: failures }));
if (failures.length) process.exitCode = 1;
