#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const HIDDEN_FRAMES = new Set(['(root)', '(idle)']);
const SERVER_READY = /carthagent dashboard: http:\/\/127\.0\.0\.1:\d+\//;
const SERVER_SETTLE_MS = 500;
const USAGE = `Usage: node tools/profile.mjs [options] [-- <command...>]

Profile a Node command with --cpu-prof and summarize the hottest functions.

Options:
  --heap            Also record a sampling heap profile (--heap-prof)
  --top <n>         Rows per table (default 15)
  --out <dir>       Output directory (default artifacts/profiles/<timestamp>)
  --server          Profile dashboard startup (node server.mjs), stopping once it is ready
  --test <file>     Profile one test file in-process (node --test --test-isolation=none)
  -h, --help        Show this help

Default command: node bin/ctg.mjs --help`;

/** Parse tools/profile.mjs arguments. */
export function parseProfileArgs(argv) {
  const options = { heap: false, top: 15, out: null, mode: 'command', command: ['node', 'bin/ctg.mjs', '--help'], help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      if (!argv[i + 1]) throw new Error('Expected a command after --');
      options.command = argv.slice(i + 1);
      break;
    }
    if (arg === '--heap') options.heap = true;
    else if (arg === '--server') options.mode = 'server';
    else if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg === '--top') options.top = positiveInteger(argv[++i], '--top');
    else if (arg === '--out') options.out = requireValue(argv[++i], '--out');
    else if (arg === '--test') {
      options.mode = 'test';
      options.testFile = requireValue(argv[++i], '--test');
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function requireValue(value, flag) {
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function positiveInteger(value, flag) {
  const parsed = Number(requireValue(value, flag));
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function frameUrl(url) {
  if (!url) return '';
  try {
    return url.startsWith('file:') ? fileURLToPath(url) : url;
  } catch {
    return url;
  }
}

function describeFrame(callFrame, root) {
  const path = frameUrl(callFrame.url);
  const firstParty = Boolean(path) && path.startsWith(root + sep) && !path.includes(`${sep}node_modules${sep}`);
  const shown = firstParty ? relative(root, path).split(sep).join('/') : path;
  const name = callFrame.functionName || (shown ? '(anonymous)' : '(unknown)');
  const location = shown ? `${shown}:${callFrame.lineNumber + 1}` : '';
  return { name, location, firstParty, key: `${name} ${location}` };
}

/** Per-sample durations in microseconds, falling back to an even split of the profile duration. */
function sampleWeights(profile) {
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  if (!samples.length) return [];
  if (deltas.length !== samples.length) {
    const even = Math.max(0, (profile.endTime - profile.startTime) / samples.length);
    return samples.map(() => even);
  }
  const weights = [];
  let time = profile.startTime;
  const stamps = deltas.map(delta => (time += delta));
  for (let i = 0; i < samples.length; i++) weights.push(Math.max(0, (i + 1 < stamps.length ? stamps[i + 1] : profile.endTime) - stamps[i]));
  return weights;
}

function indexNodes(profile) {
  const byId = new Map(profile.nodes.map(node => [node.id, node]));
  const parent = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const rootNode = profile.nodes.find(node => !parent.has(node.id)) ?? profile.nodes[0];
  return { byId, parent, rootNode };
}

function selfTimes(profile) {
  const self = new Map();
  const weights = sampleWeights(profile);
  if (weights.length) {
    profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + weights[i]));
    return self;
  }
  const hits = profile.nodes.reduce((sum, node) => sum + (node.hitCount ?? 0), 0);
  const perHit = hits ? (profile.endTime - profile.startTime) / hits : 0;
  for (const node of profile.nodes) self.set(node.id, (node.hitCount ?? 0) * perHit);
  return self;
}

/**
 * Aggregate a .cpuprofile by function: self time, and total time counted once
 * per stack even under recursion. Times are in milliseconds.
 */
export function analyzeCpuProfile(profile, { root = ROOT } = {}) {
  const { byId, rootNode } = indexNodes(profile);
  const self = selfTimes(profile);
  const functions = new Map();
  const totals = new Map();
  const totalOf = id => {
    if (!totals.has(id)) totals.set(id, (self.get(id) ?? 0) + (byId.get(id).children ?? []).reduce((sum, child) => sum + totalOf(child), 0));
    return totals.get(id);
  };
  const visit = (id, active) => {
    const node = byId.get(id);
    const frame = describeFrame(node.callFrame, root);
    const entry = functions.get(frame.key) ?? { ...frame, selfMs: 0, totalMs: 0 };
    entry.selfMs += (self.get(id) ?? 0) / 1000;
    if (!active.has(frame.key)) entry.totalMs += totalOf(id) / 1000;
    functions.set(frame.key, entry);
    const nested = new Set(active).add(frame.key);
    for (const child of node.children ?? []) visit(child, nested);
  };
  visit(rootNode.id, new Set());
  const list = [...functions.values()].filter(entry => !HIDDEN_FRAMES.has(entry.name));
  return { totalMs: totalOf(rootNode.id) / 1000, samples: profile.samples?.length ?? 0, functions: list };
}

/** Collapsed stacks ("root;caller;callee count"), one line per distinct stack, weighted by sample count. */
export function foldStacks(profile, { root = ROOT } = {}) {
  const { byId, parent } = indexNodes(profile);
  const counts = new Map();
  const label = id => {
    const frame = describeFrame(byId.get(id).callFrame, root);
    return `${frame.name}${frame.location ? ` (${frame.location})` : ''}`.replaceAll(';', ':');
  };
  for (const id of profile.samples ?? []) {
    const stack = [];
    for (let current = id; current !== undefined; current = parent.get(current)) stack.unshift(label(current));
    const frames = stack.filter(name => !HIDDEN_FRAMES.has(name));
    if (!frames.length) continue;
    const key = frames.join(';');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stack, count]) => `${stack} ${count}`)
    .join('\n');
}

/** Aggregate a sampling .heapprofile by allocating function (self bytes). */
export function analyzeHeapProfile(profile, { root = ROOT } = {}) {
  const functions = new Map();
  const walk = node => {
    const frame = describeFrame(node.callFrame, root);
    const entry = functions.get(frame.key) ?? { ...frame, selfBytes: 0 };
    entry.selfBytes += node.selfSize ?? 0;
    functions.set(frame.key, entry);
    for (const child of node.children ?? []) walk(child);
  };
  walk(profile.head);
  const list = [...functions.values()].filter(entry => entry.selfBytes > 0 && !HIDDEN_FRAMES.has(entry.name));
  return { totalBytes: list.reduce((sum, entry) => sum + entry.selfBytes, 0), functions: list };
}

function table(title, rows, { value, unit, total, top, color }) {
  const mark = row => (row.firstParty ? (color ? '\x1b[1m*' : '*') : ' ');
  const reset = row => (row.firstParty && color ? '\x1b[0m' : '');
  const lines = [title];
  for (const row of [...rows].sort((a, b) => value(b) - value(a)).slice(0, top)) {
    const share = total ? ((100 * value(row)) / total).toFixed(1).padStart(5) : '  n/a';
    lines.push(`${mark(row)} ${value(row).toFixed(1).padStart(9)}${unit} ${share}%  ${row.name}  ${row.location}${reset(row)}`);
  }
  return lines.join('\n');
}

/** Human-readable report: top functions by self and total time (first-party rows marked with *). */
export function formatCpuSummary(analysis, { top = 15, color = false } = {}) {
  const options = { unit: 'ms', total: analysis.totalMs, top, color };
  return [
    `CPU profile: ${analysis.totalMs.toFixed(1)} ms, ${analysis.samples} samples (* = first-party code)`,
    '',
    table(`Top ${top} by self time`, analysis.functions, { ...options, value: row => row.selfMs }),
    '',
    table(`Top ${top} by total time`, analysis.functions, { ...options, value: row => row.totalMs }),
    '',
    table(
      `Top ${top} first-party functions by total time`,
      analysis.functions.filter(row => row.firstParty),
      { ...options, value: row => row.totalMs },
    ),
  ].join('\n');
}

function formatHeapSummary(analysis, { top, color }) {
  const rows = analysis.functions.map(row => ({ ...row, selfKb: row.selfBytes / 1024 }));
  return table(`Top ${top} allocation sites by sampled live bytes (KiB)`, rows, {
    value: row => row.selfKb,
    unit: 'KiB',
    total: analysis.totalBytes / 1024,
    top,
    color,
  });
}

function nodeOptions(dir, heap) {
  const quoted = JSON.stringify(dir);
  return [process.env.NODE_OPTIONS, `--cpu-prof --cpu-prof-dir=${quoted}`, heap ? `--heap-prof --heap-prof-dir=${quoted}` : ''].filter(Boolean).join(' ');
}

function plannedCommand(options) {
  if (options.mode === 'test') return [process.execPath, '--test', '--test-isolation=none', options.testFile];
  if (options.mode === 'server') {
    const server = pathToFileURL(join(ROOT, 'server.mjs')).href;
    // A graceful exit is required for Node to write the profile.
    return [process.execPath, '--input-type=module', '-e', `process.on('SIGTERM', () => process.exit(0)); await import(${JSON.stringify(server)});`];
  }
  const [command, ...args] = options.command;
  return [command === 'node' ? process.execPath : command, ...args];
}

function runProfiled(options, dir) {
  const [command, ...args] = plannedCommand(options);
  const env = { ...process.env, NODE_OPTIONS: nodeOptions(dir, options.heap) };
  if (options.mode === 'server') Object.assign(env, { CARTHAGENT_PORT: '0', CARTHAGENT_NO_UPDATE_CHECK: '1', CARTHAGENT_SERVER_TOKEN: 'profile' });
  const child = spawn(command, args, { cwd: ROOT, env, stdio: ['inherit', options.mode === 'server' ? 'pipe' : 'inherit', 'inherit'] });
  if (options.mode === 'server') {
    let output = '';
    let stopping = false;
    child.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      output += chunk;
      if (stopping || !SERVER_READY.test(output)) return;
      stopping = true;
      setTimeout(() => child.kill('SIGTERM'), SERVER_SETTLE_MS).unref();
    });
  }
  return new Promise((done, fail) => {
    child.once('error', fail);
    child.once('close', code => done(code ?? 1));
  });
}

function largest(dir, extension) {
  const files = readdirSync(dir)
    .filter(name => name.endsWith(extension))
    .map(name => join(dir, name));
  return files.sort((a, b) => statSync(b).size - statSync(a).size);
}

function summarize(dir, options) {
  const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  const cpuFiles = largest(dir, '.cpuprofile');
  if (!cpuFiles.length) throw new Error(`No .cpuprofile was written to ${dir}; the command must exit normally.`);
  const profile = JSON.parse(readFileSync(cpuFiles[0], 'utf8'));
  const sections = [formatCpuSummary(analyzeCpuProfile(profile), { top: options.top, color })];
  const folded = cpuFiles[0].replace(/\.cpuprofile$/, '.folded');
  writeFileSync(folded, `${foldStacks(profile)}\n`);
  const heapFiles = options.heap ? largest(dir, '.heapprofile') : [];
  if (heapFiles.length) sections.push(formatHeapSummary(analyzeHeapProfile(JSON.parse(readFileSync(heapFiles[0], 'utf8'))), { top: options.top, color }));
  const files = [
    `CPU profile:    ${cpuFiles[0]}${cpuFiles.length > 1 ? ` (+${cpuFiles.length - 1} child process profiles in the same directory)` : ''}`,
    `Folded stacks:  ${folded}`,
    ...(heapFiles.length ? [`Heap profile:   ${heapFiles[0]}`] : []),
  ];
  const text = [...sections, [...files, 'Open the .cpuprofile in https://www.speedscope.app or Chrome DevTools > Performance.'].join('\n')].join('\n\n');
  writeFileSync(join(dir, 'summary.txt'), `${text.replace(/\x1b\[[0-9;]*m/g, '')}\n`);
  return text;
}

async function main(argv) {
  const options = parseProfileArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = resolve(options.out ?? join(ROOT, 'artifacts', 'profiles', stamp));
  mkdirSync(dir, { recursive: true });
  const code = await runProfiled(options, dir);
  if (code !== 0) console.error(`Profiled command exited with ${code}; summarizing whatever profile it wrote.`);
  console.log(`\n${summarize(dir, options)}`);
  return options.mode === 'server' ? 0 : code;
}

if (process.argv[1] && basename(process.argv[1]) === 'profile.mjs' && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    code => (process.exitCode = code),
    error => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
