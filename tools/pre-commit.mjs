#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkFileSizes, formatProblem } from './check-file-sizes.mjs';
import { scanFiles } from './check-debt-markers.mjs';
import { repositoryRoot, stagedFiles, stagedReader } from './git-files.mjs';

const PRETTIER_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const ESLINT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);

const hasExtension = (extensions, file) => extensions.has(path.posix.extname(file));

async function loadDevDependency(name) {
  try {
    return await import(name);
  } catch (error) {
    throw new Error(`${name} is not installed; run \`npm ci\` in this checkout (${error.message})`, { cause: error });
  }
}

export function sizeFailures({ files, reader }) {
  return checkFileSizes(files, reader).map(formatProblem);
}

export function debtMarkerFailures({ files, reader }) {
  return scanFiles(files, reader)
    .filter(marker => !marker.issue)
    .map(marker => `${marker.file}:${marker.line} needs a tracking issue, e.g. ${marker.marker}(#123): ${marker.text}`);
}

export async function prettierFailures({ root, files, reader }) {
  const prettier = await loadDevDependency('prettier');
  const ignorePath = [path.join(root, '.gitignore'), path.join(root, '.prettierignore')];
  const failures = [];
  for (const file of files.filter(entry => hasExtension(PRETTIER_EXTENSIONS, entry))) {
    const filepath = path.join(root, file);
    const info = await prettier.getFileInfo(filepath, { ignorePath });
    if (info.ignored || !info.inferredParser) continue;
    const options = (await prettier.resolveConfig(filepath)) ?? {};
    if (!(await prettier.check(reader.read(file).toString('utf8'), { ...options, filepath })))
      failures.push(`${file} is not formatted (npx prettier --write ${file})`);
  }
  return failures;
}

export async function eslintFailures({ root, files, reader, createLinter }) {
  const lintable = files.filter(file => hasExtension(ESLINT_EXTENSIONS, file));
  if (!lintable.length) return [];
  const linter = createLinter ? createLinter() : new (await loadDevDependency('eslint')).ESLint({ cwd: root, applySuppressions: true });
  const results = [];
  for (const file of lintable) {
    const filePath = path.join(root, file);
    if (await linter.isPathIgnored(filePath)) continue;
    results.push(...(await linter.lintText(reader.read(file).toString('utf8'), { filePath, warnIgnored: false })));
  }
  const failing = results.filter(result => result.errorCount > 0 || result.fatalErrorCount > 0);
  if (!failing.length) return [];
  const formatter = await linter.loadFormatter('stylish');
  return [(await formatter.format(failing)).trim()];
}

const CHECKS = [
  ['file size', sizeFailures],
  ['debt marker', debtMarkerFailures],
  ['Prettier', prettierFailures],
  ['ESLint', eslintFailures],
];

export async function runPreCommit({ cwd = process.cwd(), log = console.log, error = console.error, createLinter } = {}) {
  const root = repositoryRoot(cwd);
  const files = stagedFiles(root);
  if (!files.length) return 0;
  const context = { root, files, reader: stagedReader(root), createLinter };
  for (const [name, check] of CHECKS) {
    const failures = await check(context);
    if (!failures.length) continue;
    error(`pre-commit: ${name} check failed for staged content:`);
    for (const failure of failures) error(`  ${failure.replaceAll('\n', '\n  ')}`);
    error('Fix the files and stage them again.');
    return 1;
  }
  log(`pre-commit: ${files.length} staged file(s) passed size, debt-marker, Prettier and ESLint checks.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runPreCommit().then(
    code => (process.exitCode = code),
    failure => {
      console.error(`pre-commit: ${failure.message}`);
      process.exitCode = 1;
    },
  );
}
