#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FEATURE_FLAGS, expiredFlags, validateRegistry } from '../lib/feature-flags.mjs';

const SOURCE_ROOTS = ['bin', 'lib', 'extensions', 'plugins/carthagent', 'tools', 'server.mjs', 'evaluate.mjs'];
const SKIP_DIRS = new Set(['node_modules', 'tests', 'test-plugin', 'fixtures', '__pycache__']);
const SOURCE_FILE = /\.(?:mjs|cjs|js|ts|tsx|mts)$/;
const REGISTRY_FILE = 'lib/feature-flags.mjs';
const SELF_FILE = 'tools/check-feature-flags.mjs';
const FLAG_IMPORT = /feature-flags\.mjs['"]/;
const LITERAL_CALL = /\bisEnabled\(\s*(['"`])([^'"`]+)\1/g;
const ANY_CALL = /\bisEnabled\(\s*([^\s)])/g;

function walk(root, path, files) {
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOTDIR') entries = null;
    else if (error.code === 'ENOENT') return;
    else throw error;
  }
  if (!entries) {
    files.push(relative(root, path).split(sep).join('/'));
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) walk(root, join(path, entry.name), files);
    else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !entry.name.endsWith('.d.ts'))
      files.push(relative(root, join(path, entry.name)).split(sep).join('/'));
  }
}

export function sourceFiles(root) {
  const files = [];
  for (const path of SOURCE_ROOTS) walk(root, join(root, path), files);
  return files.filter(file => file !== REGISTRY_FILE && file !== SELF_FILE).sort();
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

export function findFlagReferences(files) {
  const references = [];
  const dynamic = [];
  for (const { path, text } of files) {
    if (!FLAG_IMPORT.test(text)) continue;
    for (const match of text.matchAll(LITERAL_CALL)) references.push({ name: match[2], path, line: lineOf(text, match.index) });
    for (const match of text.matchAll(ANY_CALL)) {
      if (!['"', "'", '`'].includes(match[1])) dynamic.push({ path, line: lineOf(text, match.index) });
    }
  }
  return { references, dynamic };
}

export function checkFeatureFlags({ registry = FEATURE_FLAGS, references = [], dynamic = [], today = new Date() } = {}) {
  const problems = validateRegistry(registry).map(message => ({ kind: 'invalid', message }));
  const names = new Set(registry.map(flag => flag.name));
  for (const flag of expiredFlags(registry, today)) {
    problems.push({
      kind: 'expired',
      message: `${flag.name} expired on ${flag.expires}; finish the rollout and remove it, or extend expires with a reason (owner ${flag.owner})`,
    });
  }
  for (const reference of references.filter(item => !names.has(item.name))) {
    problems.push({ kind: 'unregistered', message: `${reference.path}:${reference.line} uses unregistered flag ${reference.name}` });
  }
  const used = new Set(references.map(item => item.name));
  for (const flag of registry.filter(item => !used.has(item.name))) {
    problems.push({ kind: 'unused', message: `${flag.name} is registered but no source calls isEnabled('${flag.name}'); remove it from ${REGISTRY_FILE}` });
  }
  for (const call of dynamic) {
    problems.push({
      kind: 'dynamic',
      message: `${call.path}:${call.line} calls isEnabled() without a string literal; name the flag literally so it can be tracked`,
    });
  }
  return problems;
}

function parseArgs(argv) {
  const options = { json: false, root: resolve(import.meta.dirname, '..'), today: new Date() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') options.json = true;
    else if (argv[i] === '--root' && argv[i + 1]) options.root = resolve(argv[++i]);
    else if (argv[i] === '--today' && argv[i + 1]) options.today = new Date(`${argv[++i]}T00:00:00Z`);
    else throw Error(`Unknown option ${argv[i]}. Usage: check-feature-flags.mjs [--json] [--root <dir>] [--today YYYY-MM-DD]`);
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const options = parseArgs(process.argv.slice(2));
  const files = sourceFiles(options.root).map(path => ({ path, text: readFileSync(join(options.root, path), 'utf8') }));
  const { references, dynamic } = findFlagReferences(files);
  const problems = checkFeatureFlags({ references, dynamic, today: options.today });
  if (options.json) console.log(JSON.stringify({ flags: FEATURE_FLAGS.map(flag => flag.name), references, problems }, null, 2));
  else if (problems.length)
    console.error(`Feature flag problems (${problems.length}):\n${problems.map(problem => `  [${problem.kind}] ${problem.message}`).join('\n')}`);
  else console.log(`${FEATURE_FLAGS.length} feature flag(s) registered, ${references.length} reference(s), none expired.`);
  process.exitCode = problems.length ? 1 : 0;
}
