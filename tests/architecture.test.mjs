import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// Layer rules for first-party imports; docs/architecture-boundaries.md
// explains each layer. eslint.config.mjs mirrors these rules for editors.
const root = path.resolve(import.meta.dirname, '..');
const SOURCE_FILE = /\.(mjs|js|cjs|ts|tsx|mts|cts)$/;
const NOT_ANALYZED = /^(vendor|docs|scenarios|public)\/|\/fixtures\/|\.d\.(ts|mts)$/;
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.mjs', '/index.js'];

const PRODUCTION = /^(bin|lib|extensions)\/|^plugins\/carthagent\/(src\/|index\.ts$|tui\.ts$)|^(server|evaluate)\.mjs$/;
const PLUGIN_SERVER = /^plugins\/carthagent\/(src\/server\/|src\/(index|testing)\.ts$|index\.ts$)/;
const PLUGIN_UI = /^plugins\/carthagent\/(src\/ui\/|src\/(tui\.tsx|bootstrap\.ts)$|tui\.ts$)/;
const UI_FRAMEWORK_PACKAGE = /^(@opentui\/|solid-js(\/|$))/;

const RULES = [
  {
    name: 'production code does not import tests, tools or scenarios',
    from: PRODUCTION,
    forbidden: /^(tests|tools|scenarios)\/|^plugins\/carthagent\/(tests|test-plugin)\//,
  },
  { name: 'tools do not import tests', from: /^tools\//, forbidden: /^tests\// },
  { name: 'bin imports only lib', from: /^bin\//, forbidden: /^(?!lib\/)/ },
  { name: 'extensions import only lib', from: /^extensions\//, forbidden: /^(?!lib\/)/ },
  { name: 'lib does not import bin, extensions or plugins', from: /^lib\//, forbidden: /^(bin|extensions|plugins)\// },
  { name: 'lib/cloud is self-contained', from: /^lib\/cloud\//, forbidden: /^(?!lib\/cloud\/)/ },
  { name: 'native UI does not import the plugin server layer', from: PLUGIN_UI, forbidden: PLUGIN_SERVER },
  { name: 'plugin server does not import the native UI layer', from: PLUGIN_SERVER, forbidden: PLUGIN_UI },
  {
    name: 'only the native UI layer imports UI frameworks',
    from: /^(bin|lib|extensions)\/|^(server|evaluate)\.mjs$/,
    forbiddenPackage: UI_FRAMEWORK_PACKAGE,
  },
  { name: 'plugin server does not import UI frameworks', from: PLUGIN_SERVER, forbiddenPackage: UI_FRAMEWORK_PACKAGE },
];

// Narrow, reviewed exceptions. Each must still be in use, so removing the
// dependency also requires removing its exception.
const EXCEPTIONS = [
  {
    from: /^lib\//,
    to: 'plugins/carthagent/src/server/framing.mjs',
    reason: 'Dependency-free delivery framing contract shared by the native plugin and the legacy TUI.',
  },
  {
    from: /^lib\/opencode\/service\.mjs$/,
    to: 'plugins/carthagent/src/ui/theme-provision.mjs',
    reason: 'The CLI provisions the default native theme before starting the runtime; the module has no UI framework imports.',
  },
];

function sourceFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(file => SOURCE_FILE.test(file) && !NOT_ANALYZED.test(file));
}

function resolveRelative(file, specifier, known) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  const stem = base.replace(/\.(js|mjs)$/, '');
  const candidates = [...RESOLVE_SUFFIXES.map(suffix => base + suffix), ...RESOLVE_SUFFIXES.slice(1).map(suffix => stem + suffix)];
  return candidates.find(candidate => known.has(candidate)) ?? base;
}

function importGraph() {
  const files = sourceFiles();
  const known = new Set(files);
  return files.flatMap(file => {
    const source = readFileSync(path.join(root, file), 'utf8');
    return ts
      .preProcessFile(source, true, true)
      .importedFiles.map(({ fileName: specifier }) =>
        specifier.startsWith('.') ? { file, specifier, target: resolveRelative(file, specifier, known) } : { file, specifier, packageName: specifier },
      );
  });
}

const graph = importGraph();

function isExcepted(edge) {
  return EXCEPTIONS.some(exception => exception.from.test(edge.file) && edge.target === exception.to);
}

function violations(rule) {
  return graph.filter(edge => {
    if (!rule.from.test(edge.file)) return false;
    if (rule.forbiddenPackage) return Boolean(edge.packageName) && rule.forbiddenPackage.test(edge.packageName);
    return Boolean(edge.target) && rule.forbidden.test(edge.target) && !isExcepted(edge);
  });
}

test('the import graph covers static, re-exported and dynamic first-party imports', () => {
  const relative = graph.filter(edge => edge.target);
  assert.ok(relative.length > 300, `expected a substantial first-party graph, got ${relative.length} edges`);
  assert.ok(
    graph.some(edge => edge.file === 'lib/opencode/service.mjs' && edge.target === 'plugins/carthagent/src/ui/theme-provision.mjs'),
    'dynamic import()',
  );
  assert.ok(
    graph.some(edge => edge.file === 'lib/tui/framing.mjs' && edge.target === 'plugins/carthagent/src/server/framing.mjs'),
    'export from',
  );
  assert.ok(
    graph.some(edge => edge.file === 'plugins/carthagent/src/tui.tsx' && edge.target === 'plugins/carthagent/src/ui/client.ts'),
    '.js specifier to .ts',
  );
});

for (const rule of RULES) {
  test(`module boundary: ${rule.name}`, () => {
    const found = violations(rule).map(edge => `${edge.file} imports '${edge.specifier}'`);
    assert.deepEqual(found, [], `See docs/architecture-boundaries.md.\n${found.join('\n')}`);
  });
}

test('every module boundary exception is still needed', () => {
  for (const exception of EXCEPTIONS) {
    assert.ok(
      graph.some(edge => exception.from.test(edge.file) && edge.target === exception.to),
      `${exception.to} is no longer imported from ${exception.from}; remove the exception`,
    );
  }
});
