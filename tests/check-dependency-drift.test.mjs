import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkDependencyDrift, companionPin, formatReport } from '../tools/check-dependency-drift.mjs';

const SCRIPT = fileURLToPath(new URL('../tools/check-dependency-drift.mjs', import.meta.url));
const roots = [];
after(() => roots.forEach(root => rmSync(root, { recursive: true, force: true })));

function lockEntries({ pluginWeb = '0.25.10', seroval = '1.6.9' } = {}) {
  const packages = {
    '': {},
    'node_modules/@opencode/plugin': { version: '2.0.32', dependencies: { '@opencode/schema': '2.0.32' } },
    'node_modules/@opencode/theme': { version: '2.0.32', dependencies: { '@opentui/core': '0.5.17' } },
    'node_modules/@opentui/core': { version: '0.5.17' },
    'node_modules/web-tree-sitter': { version: '0.25.10' },
    'node_modules/seroval': { version: '1.6.9' },
    'node_modules/solid-js/node_modules/seroval': { version: seroval },
  };
  if (pluginWeb !== '0.25.10') packages['plugins/demo/node_modules/web-tree-sitter'] = { version: pluginWeb };
  return { lockfileVersion: 3, packages };
}

function fixture({ root = {}, plugin = {}, lock = lockEntries(), compatibilityVersion = '2.0.32' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ctg-drift-'));
  roots.push(dir);
  mkdirSync(join(dir, 'plugins/demo'), { recursive: true });
  mkdirSync(join(dir, 'lib/opencode'), { recursive: true });
  const rootManifest = {
    name: 'root',
    workspaces: ['plugins/*'],
    dependencies: { '@opencode/plugin': '2.0.32', '@opentui/core': '0.5.17', 'web-tree-sitter': '0.25.10' },
    overrides: { seroval: '1.6.9' },
    ...root,
  };
  const pluginManifest = {
    name: 'demo-plugin',
    dependencies: { '@opencode/plugin': '2.0.32' },
    peerDependencies: { '@opentui/core': '0.5.17' },
    devDependencies: { '@opentui/core': '0.5.17', 'web-tree-sitter': '0.25.10', 'only-here': '^1.0.0' },
    ...plugin,
  };
  writeFileSync(join(dir, 'package.json'), JSON.stringify(rootManifest));
  writeFileSync(join(dir, 'plugins/demo/package.json'), JSON.stringify(pluginManifest));
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
  writeFileSync(join(dir, 'lib/opencode/runtime-release.json'), JSON.stringify({ compatibilityVersion }));
  return dir;
}

const kinds = report => report.issues.map(issue => `${issue.kind}:${issue.name}`).sort();

test('aligned workspaces report shared dependencies and no drift', () => {
  const report = checkDependencyDrift(fixture());
  assert.deepEqual(report.workspaces, ['root', 'demo-plugin']);
  assert.deepEqual(report.shared, ['@opencode/plugin', '@opentui/core', 'web-tree-sitter']);
  assert.equal(report.opentuiVersion, '0.5.17');
  assert.deepEqual(report.issues, []);
  assert.match(formatReport(report), /No dependency drift found/);
});

test('differing ranges across workspaces and fields are drift', () => {
  const report = checkDependencyDrift(fixture({ plugin: { peerDependencies: { '@opentui/core': '>=0.5.17' } } }));
  assert.ok(kinds(report).includes('range:@opentui/core'));
  const issue = report.issues.find(item => item.kind === 'range');
  assert.deepEqual(issue.entries.map(entry => `${entry.workspace}:${entry.field}:${entry.range}`).sort(), [
    'demo-plugin:devDependencies:0.5.17',
    'demo-plugin:peerDependencies:>=0.5.17',
    'root:dependencies:0.5.17',
  ]);
  assert.match(formatReport(report), /\[range\] @opentui\/core is declared with different ranges/);
});

test('a root override that disagrees with a declared range is drift', () => {
  const report = checkDependencyDrift(fixture({ root: { overrides: { 'web-tree-sitter': '0.25.9' } } }));
  assert.deepEqual(kinds(report), ['override:web-tree-sitter', 'range:web-tree-sitter']);
});

test('the lockfile resolving two versions of a shared dependency is drift', () => {
  const report = checkDependencyDrift(fixture({ lock: lockEntries({ pluginWeb: '0.25.9' }) }));
  assert.deepEqual(kinds(report), ['lock:web-tree-sitter']);
  assert.match(report.issues[0].message, /0\.25\.10 and 0\.25\.9/);
});

test('a shared dependency missing from the lockfile is reported', () => {
  const lock = lockEntries();
  delete lock.packages['node_modules/web-tree-sitter'];
  assert.deepEqual(kinds(checkDependencyDrift(fixture({ lock }))), ['lock-missing:web-tree-sitter']);
});

test('an exact override not honored by the lockfile is drift', () => {
  assert.deepEqual(kinds(checkDependencyDrift(fixture({ lock: lockEntries({ seroval: '1.6.8' }) }))), ['override:seroval']);
});

test('@opencode/* must equal the runtime compatibility pin', () => {
  const report = checkDependencyDrift(fixture({ compatibilityVersion: '2.0.33' }));
  assert.ok(kinds(report).includes('pin:@opencode/plugin'));
  assert.match(report.issues.find(issue => issue.kind === 'pin').message, /requires exactly 2\.0\.33/);
});

test('@opentui/* must equal the version the pinned runtime packages require', () => {
  const report = checkDependencyDrift(
    fixture({ root: { dependencies: { '@opencode/plugin': '2.0.32', '@opentui/core': '0.5.18', 'web-tree-sitter': '0.25.10' } } }),
  );
  assert.ok(kinds(report).includes('pin:@opentui/core'));
  assert.ok(kinds(report).includes('range:@opentui/core'));
});

test('companionPin ignores packages outside the compatibility version', () => {
  const lock = { packages: { 'node_modules/@opencode/theme': { version: '2.0.31', dependencies: { '@opentui/core': '0.5.16' } } } };
  assert.equal(companionPin(lock, '2.0.32'), null);
});

test('CLI exits non-zero with --json output on drift', () => {
  const root = fixture({ lock: lockEntries({ pluginWeb: '0.25.9' }) });
  const result = spawnSync(process.execPath, [SCRIPT, '--json', '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).issues[0].kind, 'lock');
});

test('the repository has no dependency drift', () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
