#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { selectFiles } from './git-files.mjs';

const MIB = 1024 * 1024;
export const MAX_BYTES = MIB;
export const MAX_SOURCE_LINES = 1500;

const SOURCE_EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.py', '.sh']);
const NON_SOURCE_DIRECTORIES = ['vendor/', 'docs/', 'scenarios/', 'tests/fixtures/', 'tools/benchmark/fixtures/'];

// Each exception names its own ceiling so an allowed file still cannot grow
// without a reviewed change to this list.
export const EXCEPTIONS = [
  {
    pattern: 'vendor/agent/**',
    maxBytes: 8 * MIB,
    reason: 'Pinned third-party bundle of the legacy agent runtime; replaced as a unit and never edited by hand.',
  },
  {
    pattern: 'docs/patches/*.patch',
    maxBytes: 2 * MIB,
    reason: 'Byte-exact owned-runtime patch stacks pinned by digest (docs/opencode-owned-runtime.md).',
  },
  { pattern: 'lib/tui/app.mjs', maxLines: 3400, reason: 'Legacy TUI application module; splitting it is tracked in docs/tech-debt.md.' },
  { pattern: 'lib/opencode/cli-runtime.mjs', maxLines: 1900, reason: 'Native CLI runtime orchestration; splitting it is tracked in docs/tech-debt.md.' },
  {
    pattern: 'plugins/carthagent/src/ui/voyages-art.mjs',
    maxLines: 2200,
    reason: 'Voyages artwork tables and renderers; splitting it is tracked in docs/tech-debt.md.',
  },
  { pattern: 'tests/opencode-cli.test.mjs', maxLines: 2900, reason: 'CLI regression suite; splitting it by command is tracked in docs/tech-debt.md.' },
  { pattern: 'tests/opencode-runtime.test.mjs', maxLines: 1600, reason: 'Runtime regression suite; splitting it is tracked in docs/tech-debt.md.' },
];

const USAGE = `Usage: node tools/check-file-sizes.mjs [--staged] [file...]

Fails when a tracked file exceeds ${MAX_BYTES / MIB} MiB or a first-party source file
exceeds ${MAX_SOURCE_LINES} lines, unless an entry in EXCEPTIONS allows it.
  --staged   check the staged (index) version of staged files
  file...    check only these paths`;

export function globToRegExp(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (pattern.startsWith('**/', index)) {
      source += '(?:.*/)?';
      index += 2;
    } else if (pattern.startsWith('**', index)) {
      source += '.*';
      index += 1;
    } else if (char === '*') source += '[^/]*';
    else source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

export function isLineCheckedSource(file) {
  return SOURCE_EXTENSIONS.has(path.posix.extname(file)) && !NON_SOURCE_DIRECTORIES.some(directory => file.startsWith(directory));
}

export function countLines(buffer) {
  let lines = 0;
  for (let index = buffer.indexOf(10); index !== -1; index = buffer.indexOf(10, index + 1)) lines++;
  return buffer.length && buffer[buffer.length - 1] !== 10 ? lines + 1 : lines;
}

function compileExceptions(exceptions) {
  return exceptions.map(exception => ({ ...exception, regex: globToRegExp(exception.pattern) }));
}

function limitsFor(file, { maxBytes = MAX_BYTES, maxLines = MAX_SOURCE_LINES, exceptions }) {
  const exception = exceptions.find(entry => entry.regex.test(file));
  if (!exception) return { bytes: maxBytes, lines: maxLines, exception: null };
  return { bytes: exception.maxBytes ?? maxBytes, lines: exception.maxLines ?? maxLines, exception: exception.pattern };
}

export function checkFile(file, reader, { exceptions = compileExceptions(EXCEPTIONS), ...options } = {}) {
  const size = reader.size(file);
  if (size === null) return [];
  const limits = limitsFor(file, { ...options, exceptions });
  if (size > limits.bytes) return [{ file, kind: 'bytes', actual: size, limit: limits.bytes, exception: limits.exception }];
  if (!isLineCheckedSource(file)) return [];
  const lines = countLines(reader.read(file));
  return lines > limits.lines ? [{ file, kind: 'lines', actual: lines, limit: limits.lines, exception: limits.exception }] : [];
}

export function checkFileSizes(files, reader, options = {}) {
  const exceptions = compileExceptions(options.exceptions ?? EXCEPTIONS);
  return files.flatMap(file => checkFile(file, reader, { ...options, exceptions }));
}

export function staleExceptions(files, reader, { exceptions = EXCEPTIONS, maxBytes = MAX_BYTES, maxLines = MAX_SOURCE_LINES } = {}) {
  return compileExceptions(exceptions).flatMap(exception => {
    const matched = files.filter(file => exception.regex.test(file));
    if (!matched.length) return [`${exception.pattern}: exception matches no tracked file; remove it`];
    if (exception.maxLines === undefined || exception.pattern.includes('*')) return [];
    const needed = matched.some(file => (reader.size(file) ?? 0) > maxBytes || countLines(reader.read(file)) > maxLines);
    return needed ? [] : [`${exception.pattern}: now within the default limits; remove its exception`];
  });
}

const formatBytes = bytes => `${(bytes / MIB).toFixed(2)} MiB`;

export function formatProblem(problem) {
  const allowance = problem.exception ? ` allowed by the "${problem.exception}" exception` : '';
  return problem.kind === 'bytes'
    ? `${problem.file}: ${formatBytes(problem.actual)} exceeds the ${formatBytes(problem.limit)} size limit${allowance}`
    : `${problem.file}: ${problem.actual} lines exceeds the ${problem.limit}-line source file limit${allowance}`;
}

export function main(argv = process.argv.slice(2), { cwd = process.cwd(), log = console.log, error = console.error } = {}) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { staged: { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) {
    log(USAGE);
    return 0;
  }
  const { files, reader } = selectFiles({ cwd, staged: values.staged, paths: positionals });
  const problems = checkFileSizes(files, reader);
  if (!values.staged && !positionals.length) for (const warning of staleExceptions(files, reader)) error(`check-file-sizes: warning: ${warning}`);
  if (!problems.length) {
    log(`check-file-sizes: ${files.length} file(s) within limits.`);
    return 0;
  }
  error(`check-file-sizes: ${problems.length} file(s) over the limit:`);
  for (const problem of problems) error(`  ${formatProblem(problem)}`);
  error('Split large modules, keep binaries and generated output out of git, or add a reviewed exception with a reason in tools/check-file-sizes.mjs.');
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main();
