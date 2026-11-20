#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { selectFiles } from './git-files.mjs';

export const MARKERS = ['TODO', 'FIXME', 'HACK', 'XXX'];
const MARKER_PATTERN = new RegExp(`\\b(${MARKERS.join('|')})\\b`, 'g');
const ISSUE_SUFFIX = /^\(((?:[\w.-]+\/[\w.-]+)?#\d+)\)/;
const ISSUE_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+/;

const SLASH_COMMENT_EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const HASH_COMMENT_EXTENSIONS = new Set(['.py', '.sh', '.yml', '.yaml']);
const EXCLUDED_DIRECTORIES = ['vendor/', 'docs/', 'scenarios/', 'tests/fixtures/', 'tools/benchmark/fixtures/', 'node_modules/'];
// These files define and exercise the marker syntax itself.
const EXCLUDED_FILES = new Set(['tools/check-debt-markers.mjs', 'tests/check-debt-markers.test.mjs']);
const HOOK_FILES = new Set(['.githooks/pre-commit', '.githooks/pre-push']);

const USAGE = `Usage: node tools/check-debt-markers.mjs [--json] [--staged] [file...]

Inventories ${MARKERS.join('/')} comments in first-party source and fails when one does
not reference a tracking issue, written as TODO(#123), TODO(owner/repo#123) or
with a https://github.com/<owner>/<repo>/issues/<number> URL on the same line.`;

function commentSyntax(file) {
  const extension = path.posix.extname(file);
  if (SLASH_COMMENT_EXTENSIONS.has(extension)) return 'slash';
  if (HASH_COMMENT_EXTENSIONS.has(extension) || HOOK_FILES.has(file)) return 'hash';
  return null;
}

export function isScanned(file) {
  return commentSyntax(file) !== null && !EXCLUDED_FILES.has(file) && !EXCLUDED_DIRECTORIES.some(directory => file.startsWith(directory));
}

function commentStart(line, syntax) {
  if (syntax === 'hash') return line.indexOf('#');
  if (/^\s*\*/.test(line)) return 0;
  const starts = [line.indexOf('//'), line.indexOf('/*')].filter(index => index >= 0);
  return starts.length ? Math.min(...starts) : -1;
}

function issueReference(line, markerEnd) {
  return line.slice(markerEnd).match(ISSUE_SUFFIX)?.[1] ?? line.match(ISSUE_URL)?.[0] ?? null;
}

export function findMarkers(file, text) {
  const syntax = commentSyntax(file);
  if (!syntax) return [];
  const markers = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const start = commentStart(line, syntax);
    if (start < 0) return;
    for (const match of line.matchAll(MARKER_PATTERN)) {
      if (match.index < start) continue;
      const issue = issueReference(line, match.index + match[0].length);
      markers.push({ file, line: index + 1, marker: match[1], issue, text: line.trim().slice(0, 200) });
    }
  });
  return markers;
}

export function scanFiles(files, reader) {
  return files.filter(isScanned).flatMap(file => (reader.size(file) === null ? [] : findMarkers(file, reader.read(file).toString('utf8'))));
}

export function summarize(markers) {
  const byMarker = Object.fromEntries(MARKERS.map(marker => [marker, 0]));
  const byFile = {};
  for (const { file, marker } of markers) {
    byMarker[marker]++;
    byFile[file] ??= {};
    byFile[file][marker] = (byFile[file][marker] ?? 0) + 1;
  }
  const unlinked = markers.filter(marker => !marker.issue);
  return { total: markers.length, linked: markers.length - unlinked.length, unlinked: unlinked.length, byMarker, byFile, markers };
}

export function formatInventory(summary) {
  const counts = MARKERS.map(marker => `${marker} ${summary.byMarker[marker]}`).join(', ');
  const lines = [`Debt markers: ${summary.total} (${counts}); ${summary.unlinked} without a tracking issue.`];
  for (const [file, counts] of Object.entries(summary.byFile).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(
      `  ${file}: ${Object.entries(counts)
        .map(([marker, count]) => `${marker} ${count}`)
        .join(', ')}`,
    );
  }
  return lines.join('\n');
}

export function main(argv = process.argv.slice(2), { cwd = process.cwd(), log = console.log, error = console.error } = {}) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { json: { type: 'boolean' }, staged: { type: 'boolean' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    log(USAGE);
    return 0;
  }
  const { files, reader } = selectFiles({ cwd, staged: values.staged, paths: positionals });
  const summary = summarize(scanFiles(files, reader));
  log(values.json ? JSON.stringify(summary, null, 2) : formatInventory(summary));
  if (!summary.unlinked) return 0;
  error('check-debt-markers: these markers need a tracking issue, e.g. TODO(#123) or a GitHub issue URL:');
  for (const marker of summary.markers.filter(entry => !entry.issue)) error(`  ${marker.file}:${marker.line}  ${marker.text}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main();
