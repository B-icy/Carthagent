#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const paths = ['bin', 'lib', 'tools', 'evaluate.mjs', 'server.mjs'];
const CACHE_FILE = join(root, 'node_modules', '.cache', 'ctg', 'check-syntax.json');
const useCache = !process.argv.includes('--no-cache');
const files = [];

function collect(path) {
  if (path.endsWith('.mjs')) {
    files.push(path);
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) collect(child);
    else if (entry.name.endsWith('.mjs')) files.push(child);
  }
}

// A passing `node --check` depends only on the file bytes and the Node version.
function readCache() {
  if (!useCache) return {};
  try {
    const cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    return cache.node === process.version ? cache.files : {};
  } catch {
    return {};
  }
}

function writeCache(passed) {
  if (!useCache) return;
  mkdirSync(dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify({ node: process.version, files: passed }));
}

function checkFile(item) {
  return new Promise(done => {
    const child = spawn(process.execPath, ['--check', item.file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => (output += chunk));
    child.stderr.on('data', chunk => (output += chunk));
    child.on('close', status => done({ ...item, status, output }));
  });
}

async function runPool(items, limit, worker) {
  const results = [];
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) results.push(await worker(items[next++]));
  });
  await Promise.all(lanes);
  return results;
}

for (const path of paths) collect(join(root, path));
const cached = readCache();
const passed = {};
const pending = [];
for (const file of files.sort()) {
  const key = relative(root, file).split(sep).join('/');
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (cached[key] === hash) passed[key] = hash;
  else pending.push({ file, key, hash });
}
const results = await runPool(pending, availableParallelism(), checkFile);
const failures = results.filter(result => result.status !== 0).sort((a, b) => a.key.localeCompare(b.key));
for (const result of results) if (result.status === 0) passed[result.key] = result.hash;
writeCache(passed);
for (const failure of failures) process.stderr.write(failure.output);
if (failures.length) {
  console.error(`Syntax errors in ${failures.length} of ${files.length} JavaScript files.`);
  process.exit(failures[0].status || 1);
}
console.log(`Checked ${files.length} JavaScript files (${pending.length} re-checked, ${files.length - pending.length} unchanged since the last passing run).`);
