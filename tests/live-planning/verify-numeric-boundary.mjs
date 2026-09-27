// Post-run exploratory probe, not injected into the candidate's declared checks.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { handleSummary } = await import(pathToFileURL(resolve('packages/api/index.mjs')));
const failures = [];
for (const amount of [10000000.03, 10000000.04, 10000000.05, -10000000.03]) {
  try {
    const numeric = handleSummary({ entries: [{ amount }] });
    const string = handleSummary({ entries: [{ amount: String(amount) }] });
    assert.equal(numeric.status, 200, JSON.stringify(numeric));
    assert.equal(numeric.body.totalDecimal, string.body.totalDecimal);
    console.log(`PASS numeric/string equivalence ${amount}`);
  } catch (error) {
    failures.push(amount);
    console.error(`FAIL numeric/string equivalence ${amount}: ${error.message}`);
  }
}
console.log(JSON.stringify({ failedAmounts: failures }));
if (failures.length) process.exitCode = 1;
