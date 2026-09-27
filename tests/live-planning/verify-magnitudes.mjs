// Independent exploratory follow-on: not injected into candidate checks.
// Keep this separate so the original four retained boundary probes are unchanged.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { handleSummary } = await import(pathToFileURL(resolve('packages/api/index.mjs')));
let cases = 0;
const failures = [];
for (const magnitude of [1, 1000, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12]) {
  for (const fraction of ['01', '03', '04', '05', '07', '09', '29', '99']) {
    for (const sign of ['', '-']) {
      const text = `${sign}${magnitude}.${fraction}`, amount = Number(text);
      cases++;
      try {
        const numeric = handleSummary({ entries: [{ amount }] });
        const string = handleSummary({ entries: [{ amount: text }] });
        assert.equal(numeric.status, 200, JSON.stringify(numeric));
        assert.equal(string.status, 200, JSON.stringify(string));
        assert.equal(numeric.body.totalDecimal, string.body.totalDecimal);
      } catch (error) { failures.push({ text, error: error.message }); }
    }
  }
}
console.log(JSON.stringify({ cases, failures }, null, 2));
if (failures.length) process.exitCode = 1;
