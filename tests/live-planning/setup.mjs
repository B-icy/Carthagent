import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const trial = process.env.CTG_TRIAL || '';
if (trial && !/^[a-z0-9-]+$/.test(trial)) throw Error('CTG_TRIAL must be a safe trial name');
const suffix = trial ? `-${trial}` : '';
const cwd = join(root, `workspace${suffix}`);
if (existsSync(cwd)) throw Error('Workspace already exists; preserve trial evidence rather than overwriting it.');
const files = {
  '.gitignore': '.harness/\nartifacts/\nnode_modules/\n',
  'package.json': JSON.stringify({ name: 'billing-planning-trial', private: true, type: 'module', scripts: { test: 'node --test tests/*.test.mjs', check: 'node scripts/check.mjs', quality: 'npm run check && npm test' } }, null, 2),
  'README.md': '# Billing workspace\n\nNode 22+, no external dependencies. Run `npm run quality`.\n\nPackages: money (shared arithmetic), ledger (domain), api (JSON boundary), csv (batch export), cli (public executable). The API and CLI must remain backward compatible. CSV is consumed by a legacy reconciler: preserve its header, row order, and exactly two decimal places. Existing tests are compatibility contracts; do not delete or weaken them.\n',
  'packages/money/index.mjs': 'export function totalAmounts(amounts) { return amounts.reduce((sum, amount) => sum + Number(amount), 0); }\n',
  'packages/ledger/index.mjs': "import { totalAmounts } from '../money/index.mjs';\nexport function summarize(entries) { return { count: entries.length, total: totalAmounts(entries.map(entry => entry.amount)) }; }\n",
  'packages/api/index.mjs': "import { summarize } from '../ledger/index.mjs';\nexport function handleSummary(body) {\n  if (!body || !Array.isArray(body.entries)) return { status: 400, body: { error: 'entries must be an array' } };\n  return { status: 200, body: summarize(body.entries) };\n}\n",
  'packages/csv/index.mjs': "export function exportCsv(entries) {\n  return 'id,amount\\n' + entries.map(entry => `${entry.id},${Number(entry.amount).toFixed(2)}`).join('\\n') + '\\n';\n}\n",
  'packages/cli/main.mjs': "import { readFileSync } from 'node:fs';\nimport { handleSummary } from '../api/index.mjs';\nconst response = handleSummary(JSON.parse(readFileSync(process.argv[2], 'utf8')));\nconsole.log(JSON.stringify(response.body));\nif (response.status !== 200) process.exitCode = 1;\n",
  'tests/legacy.test.mjs': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { totalAmounts } from '../packages/money/index.mjs';\nimport { handleSummary } from '../packages/api/index.mjs';\nimport { exportCsv } from '../packages/csv/index.mjs';\ntest('legacy numeric totals and API shape', () => {\n  assert.equal(totalAmounts([1, 2, 3]), 6);\n  const result = handleSummary({ entries: [{ amount: 2 }, { amount: 3 }] });\n  assert.equal(result.status, 200); assert.equal(result.body.count, 2); assert.equal(result.body.total, 5);\n  assert.equal(handleSummary({}).status, 400);\n});\ntest('legacy CSV formatting', () => {\n  assert.equal(exportCsv([{ id: 'café', amount: 1 }, { id: 'refund', amount: -2.5 }]), 'id,amount\\ncafé,1.00\\nrefund,-2.50\\n');\n});\n",
  'scripts/check.mjs': "import { readdirSync } from 'node:fs';\nimport { join } from 'node:path';\nimport { execFileSync } from 'node:child_process';\nfunction walk(dir) { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) walk(path); else if (path.endsWith('.mjs')) execFileSync(process.execPath, ['--check', path], { stdio: 'inherit' }); } }\nwalk('packages'); walk('tests');\n",
};
for (const [path, content] of Object.entries(files)) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), content);
}
execFileSync('git', ['init', '-q'], { cwd });
execFileSync('git', ['add', '.'], { cwd });
execFileSync('git', ['-c', 'user.name=Planning Trial', '-c', 'user.email=planning-trial@localhost', 'commit', '-qm', 'Seed billing compatibility fixture'], { cwd });
writeFileSync(join(root, `validators${suffix}.json`), JSON.stringify({ version: 1, checks: [{ id: 'billing_contract', kind: 'test', argv: [process.execPath, join(root, 'verify.mjs'), 'base'], timeoutSeconds: 30 }] }, null, 2) + '\n');
console.log(cwd);
