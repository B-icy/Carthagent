#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const PINNED_SCOPE = '@opencode/';
const COMPANION_SCOPE = '@opentui/';
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function workspacePatterns(manifest) {
  const workspaces = manifest.workspaces;
  if (Array.isArray(workspaces)) return workspaces;
  return Array.isArray(workspaces?.packages) ? workspaces.packages : [];
}

export function expandWorkspaces(root, patterns) {
  const dirs = [];
  for (const pattern of patterns) {
    const normalized = pattern.replace(/\/+$/, '');
    if (!normalized.endsWith('/*')) {
      if (existsSync(join(root, normalized, 'package.json'))) dirs.push(normalized);
      continue;
    }
    const parent = normalized.slice(0, -2);
    if (!existsSync(join(root, parent))) continue;
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
      const dir = posix.join(parent, entry.name);
      if (entry.isDirectory() && existsSync(join(root, dir, 'package.json'))) dirs.push(dir);
    }
  }
  return dirs.sort();
}

export function loadWorkspaces(root) {
  const manifest = readJson(join(root, 'package.json'));
  const workspaces = [{ dir: '', manifest }];
  for (const dir of expandWorkspaces(root, workspacePatterns(manifest))) {
    workspaces.push({ dir, manifest: readJson(join(root, dir, 'package.json')) });
  }
  return workspaces;
}

function workspaceLabel(workspace) {
  return workspace.manifest.name || workspace.dir || '(root)';
}

export function collectDeclarations(workspaces) {
  const declarations = new Map();
  for (const workspace of workspaces) {
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, range] of Object.entries(workspace.manifest[field] ?? {})) {
        if (!declarations.has(name)) declarations.set(name, []);
        declarations.get(name).push({ workspace: workspaceLabel(workspace), dir: workspace.dir, field, range });
      }
    }
  }
  return declarations;
}

export function sharedDependencyNames(declarations) {
  const shared = [];
  for (const [name, entries] of declarations) {
    if (new Set(entries.map(entry => entry.dir)).size > 1) shared.push(name);
  }
  return shared.sort();
}

export function findRangeDrift(declarations, overrides = {}) {
  const issues = [];
  for (const [name, entries] of [...declarations].sort(([a], [b]) => a.localeCompare(b))) {
    const all = [...entries];
    if (typeof overrides[name] === 'string' && !overrides[name].startsWith('$')) {
      all.push({ workspace: '(root overrides)', dir: '', field: 'overrides', range: overrides[name] });
    }
    const ranges = new Set(all.map(entry => entry.range));
    if (ranges.size > 1) {
      issues.push({ kind: 'range', name, message: `${name} is declared with different ranges`, entries: all });
    }
  }
  return issues;
}

export function resolveLockedVersion(lock, dir, name) {
  const packages = lock.packages ?? {};
  const candidates = dir ? [`${dir}/node_modules/${name}`, `node_modules/${name}`] : [`node_modules/${name}`];
  for (const key of candidates) {
    if (packages[key]) return { key, version: packages[key].version ?? null };
  }
  return null;
}

export function findLockDrift(lock, declarations, sharedNames) {
  const issues = [];
  for (const name of sharedNames) {
    const dirs = [...new Set(declarations.get(name).map(entry => entry.dir))];
    const resolved = dirs.map(dir => ({ dir: dir || '(root)', ...(resolveLockedVersion(lock, dir, name) ?? { key: null, version: null }) }));
    const missing = resolved.filter(entry => entry.version === null);
    const versions = new Set(resolved.filter(entry => entry.version !== null).map(entry => entry.version));
    if (missing.length) {
      issues.push({
        kind: 'lock-missing',
        name,
        message: `${name} is not resolved in package-lock.json for ${missing.map(entry => entry.dir).join(', ')}`,
        resolved,
      });
    } else if (versions.size > 1) {
      issues.push({ kind: 'lock', name, message: `${name} resolves to ${[...versions].join(' and ')} across workspaces`, resolved });
    }
  }
  return issues;
}

export function findOverrideDrift(lock, overrides = {}) {
  const issues = [];
  for (const [name, range] of Object.entries(overrides)) {
    if (typeof range !== 'string' || !EXACT_VERSION.test(range)) continue;
    const suffix = `node_modules/${name}`;
    const offenders = Object.entries(lock.packages ?? {})
      .filter(([key, value]) => (key === suffix || key.endsWith(`/${suffix}`)) && value.version !== range)
      .map(([key, value]) => ({ key, version: value.version }));
    if (offenders.length) {
      issues.push({
        kind: 'override',
        name,
        message: `${name} is overridden to ${range} but the lockfile has ${offenders.map(o => `${o.version} at ${o.key}`).join(', ')}`,
        offenders,
      });
    }
  }
  return issues;
}

export function companionPin(lock, compatibilityVersion) {
  const pins = new Set();
  for (const [key, value] of Object.entries(lock.packages ?? {})) {
    if (!key.startsWith(`node_modules/${PINNED_SCOPE}`) || value.version !== compatibilityVersion) continue;
    for (const [name, range] of Object.entries(value.dependencies ?? {})) {
      if (name.startsWith(COMPANION_SCOPE) && EXACT_VERSION.test(range)) pins.add(range);
    }
  }
  return pins.size === 1 ? [...pins][0] : null;
}

function pinIssue(name, entry, expected, reason) {
  return {
    kind: 'pin',
    name,
    message: `${name} in ${entry.workspace} ${entry.field} is ${entry.range}; ${reason} requires exactly ${expected}`,
    entries: [entry],
  };
}

export function findPinDrift(declarations, { compatibilityVersion, opentuiVersion }) {
  const issues = [];
  for (const [name, entries] of declarations) {
    const expected = name.startsWith(PINNED_SCOPE) ? compatibilityVersion : name.startsWith(COMPANION_SCOPE) ? opentuiVersion : null;
    if (!expected) continue;
    const reason = name.startsWith(PINNED_SCOPE) ? 'runtime-release.json compatibilityVersion' : `@opencode/* ${compatibilityVersion}`;
    for (const entry of entries) {
      if (entry.range !== expected) issues.push(pinIssue(name, entry, expected, reason));
    }
  }
  return issues;
}

export function checkDependencyDrift(root) {
  const workspaces = loadWorkspaces(root);
  const declarations = collectDeclarations(workspaces);
  const shared = sharedDependencyNames(declarations);
  const lock = readJson(join(root, 'package-lock.json'));
  const overrides = workspaces[0].manifest.overrides ?? {};
  const { compatibilityVersion } = readJson(join(root, 'lib/opencode/runtime-release.json'));
  const opentuiVersion = companionPin(lock, compatibilityVersion);
  const issues = [
    ...findRangeDrift(declarations, overrides),
    ...findLockDrift(lock, declarations, shared),
    ...findOverrideDrift(lock, overrides),
    ...findPinDrift(declarations, { compatibilityVersion, opentuiVersion }),
  ];
  if (opentuiVersion === null && [...declarations.keys()].some(name => name.startsWith(COMPANION_SCOPE))) {
    issues.push({
      kind: 'pin',
      name: COMPANION_SCOPE,
      message: `Cannot derive one exact ${COMPANION_SCOPE}* version from the locked ${PINNED_SCOPE}*@${compatibilityVersion} packages`,
    });
  }
  return { workspaces: workspaces.map(workspaceLabel), shared, compatibilityVersion, opentuiVersion, issues };
}

export function formatReport(report) {
  const lines = [
    `Workspaces: ${report.workspaces.join(', ')}`,
    `Shared dependencies: ${report.shared.length ? report.shared.join(', ') : 'none'}`,
    `Pins: @opencode/* ${report.compatibilityVersion}, @opentui/* ${report.opentuiVersion ?? 'unknown'}`,
  ];
  if (!report.issues.length) return [...lines, 'No dependency drift found.'].join('\n');
  lines.push(`Dependency drift (${report.issues.length}):`);
  for (const issue of report.issues) {
    lines.push(`  [${issue.kind}] ${issue.message}`);
    for (const entry of issue.entries ?? []) lines.push(`      ${entry.workspace} ${entry.field}: ${entry.range}`);
    for (const entry of issue.resolved ?? []) lines.push(`      ${entry.dir}: ${entry.version ?? 'missing'}${entry.key ? ` (${entry.key})` : ''}`);
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const options = { json: false, root: resolve(import.meta.dirname, '..') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') options.json = true;
    else if (argv[i] === '--root') options.root = resolve(argv[++i]);
    else throw Error(`Unknown option: ${argv[i]}. Usage: check-dependency-drift.mjs [--json] [--root <dir>]`);
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const options = parseArgs(process.argv.slice(2));
  const report = checkDependencyDrift(options.root);
  console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
  process.exitCode = report.issues.length ? 1 : 0;
}
