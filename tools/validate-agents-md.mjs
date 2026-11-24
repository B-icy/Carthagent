#!/usr/bin/env node
import { existsSync, globSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const NPM_COMMANDS = new Set([
  'access',
  'audit',
  'cache',
  'ci',
  'config',
  'dedupe',
  'doctor',
  'exec',
  'explain',
  'help',
  'i',
  'init',
  'install',
  'link',
  'ls',
  'outdated',
  'pack',
  'prune',
  'publish',
  'rebuild',
  'restart',
  'run',
  'run-script',
  'start',
  'stop',
  't',
  'test',
  'uninstall',
  'update',
  'version',
  'view',
  'x',
]);
const SCRIPT_ALIASES = { t: 'test', test: 'test', start: 'start', stop: 'stop', restart: 'restart' };
const KNOWN_ROOTS = [
  'bin',
  'lib',
  'tools',
  'docs',
  'tests',
  '.github',
  'plugins',
  'extensions',
  'vendor',
  'scenarios',
  'skills',
  'prompts',
  'public',
  'script',
  'guidance',
  '.devcontainer',
];
const OUTPUT_ROOTS = new Set(['artifacts', '.harness', 'coverage']);
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'artifacts', '.harness']);
const FILE_EXTENSIONS = /\.(md|json|jsonc|mjs|cjs|js|ts|tsx|py|sh|yml|yaml|d2|svg|txt)$/;
const USAGE = `Usage: node tools/validate-agents-md.mjs [--links-only] [--root dir] [file-or-glob ...]

Validates agent instructions (default AGENTS.md): npm commands exist in
package.json, node/python script paths and backticked repository paths exist,
relative Markdown links and anchors resolve, the Node.js version statement
matches package.json engines, and AGENTS.md has setup and development sections.
--links-only checks only Markdown links (useful for docs/*.md).`;

export function githubSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

export function scanMarkdown(text) {
  const lines = text.split(/\r?\n/);
  const result = { codeLines: [], proseLines: [], headings: [] };
  let fence = null;
  lines.forEach((line, index) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker && (!fence || marker[1][0] === fence[0])) {
      fence = fence ? null : marker[1];
      return;
    }
    const entry = { line: index + 1, text: line };
    if (fence) result.codeLines.push(entry);
    else {
      result.proseLines.push(entry);
      const heading = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
      if (heading) result.headings.push({ ...entry, title: heading[1] });
    }
  });
  return result;
}

function anchorsOf(text) {
  const { headings } = scanMarkdown(text);
  const anchors = new Set();
  const counts = new Map();
  for (const { title } of headings) {
    const slug = githubSlug(title.replace(/`/g, ''));
    const seen = counts.get(slug) || 0;
    anchors.add(seen ? `${slug}-${seen}` : slug);
    counts.set(slug, seen + 1);
  }
  for (const match of text.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(match[1]);
  return anchors;
}

function inlineCodeSpans(line) {
  return [...line.replace(/\\`/g, '').matchAll(/(`+)([^`]+?)\1/g)].map(match => match[2].trim());
}

function linkTargets(line) {
  const inline = [...line.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map(match => match[1]);
  const reference = line.match(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/);
  return reference ? [...inline, reference[1]] : inline;
}

function checkLink(target, context) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return null;
  const [rawPath, fragment] = target.split('#');
  const path = decodeURIComponent(rawPath);
  const file = path ? resolve(dirname(context.file), path) : context.file;
  if (path && !existsSync(file)) return `broken link ${target}: ${relative(context.root, file).split(sep).join('/')} does not exist`;
  if (!fragment || !file.endsWith('.md') || statSync(file).isDirectory()) return null;
  const anchors = anchorsOf(file === context.file ? context.text : readFileSync(file, 'utf8'));
  return anchors.has(fragment.toLowerCase()) || anchors.has(fragment) ? null : `broken link ${target}: no heading or anchor #${fragment}`;
}

function npmProblems(text, scripts) {
  const problems = [];
  for (const match of text.matchAll(/\bnpm\s+(run(?:-script)?\s+)?([a-z][\w:.-]*)/gi)) {
    const [, run, name] = match;
    if (run) {
      if (!(name in scripts)) problems.push(`npm run ${name}: no "${name}" script in package.json`);
    } else if (!NPM_COMMANDS.has(name)) problems.push(`npm ${name}: not an npm command (did you mean npm run ${name}?)`);
    else if (SCRIPT_ALIASES[name] && !(SCRIPT_ALIASES[name] in scripts)) problems.push(`npm ${name}: no "${SCRIPT_ALIASES[name]}" script in package.json`);
  }
  return problems;
}

function pathProblem(candidate, root, label) {
  const path = candidate.replace(/[.,;:]+$/, '');
  if (/[<>{}$]/.test(path)) return null;
  if (path.includes('*')) return globSync(path, { cwd: root }).length ? null : `${label} ${path}: no files match`;
  return existsSync(join(root, path)) ? null : `${label} ${path}: does not exist`;
}

function scriptProblems(text, root) {
  const problems = [];
  const pattern = /\b(node|python3?|bash|sh)\s+((?:--?[\w-]+(?:=\S+)?\s+)*)([^\s`'"|;&)]+\.(?:mjs|cjs|js|ts|py|sh))/g;
  for (const [, runner, , path] of text.matchAll(pattern)) {
    if (path.startsWith('/') || path.startsWith('~')) continue;
    const problem = pathProblem(path, root, `${runner} script`);
    if (problem) problems.push(problem);
  }
  return problems;
}

function isRepoPath(span, root) {
  if (/\s|:\/\/|^[~/@$-]/.test(span) || span.startsWith('../')) return false;
  const first = span.split('/')[0];
  if (OUTPUT_ROOTS.has(first)) return false;
  if (span.includes('/')) return KNOWN_ROOTS.includes(first) || existsSync(join(root, first));
  return FILE_EXTENSIONS.test(span) && !span.startsWith('.') && /^[\w.-]+$/.test(span);
}

function existsAnywhere(name, root) {
  return globSync(`**/${name}`, { cwd: root, exclude: entry => SKIPPED_DIRECTORIES.has(basename(entry)) }).length > 0;
}

function spanProblems(span, root) {
  if (!isRepoPath(span, root)) return [];
  if (!span.includes('/')) return existsAnywhere(span, root) ? [] : [`path ${span}: no file with this name in the repository`];
  const problem = pathProblem(span.replace(/\/$/, ''), root, 'path');
  return problem ? [problem] : [];
}

function nodeVersionProblems(scan, engines, required) {
  const spans = [];
  for (const { line, text } of scan.proseLines) {
    if (!/\bnode(?:\.js)?\b/i.test(text)) continue;
    for (const span of inlineCodeSpans(text)) if (/\d/.test(span) && /^[\s\d.^~<>=|x*-]+$/.test(span)) spans.push({ line, span });
  }
  if (!engines) return spans.length ? [{ line: spans[0].line, message: 'package.json has no engines.node to compare against' }] : [];
  if (!spans.length) return required ? [{ line: 1, message: `no Node.js version statement; expected \`${engines}\` from package.json engines` }] : [];
  return spans
    .filter(({ span }) => span !== engines)
    .map(({ line, span }) => ({ line, message: `Node.js version \`${span}\` does not match package.json engines \`${engines}\`` }));
}

function structureProblems(text, scan) {
  const problems = [];
  if (text.trim().length <= 100) problems.push({ line: 1, message: 'AGENTS.md is too short to be useful (100 characters or fewer)' });
  const titles = scan.headings.map(heading => heading.title);
  if (!titles.some(title => /setup|install|getting started/i.test(title))) problems.push({ line: 1, message: 'missing a Setup section heading' });
  if (!titles.some(title => /develop|verif|test|build/i.test(title)))
    problems.push({ line: 1, message: 'missing a Development or verification section heading' });
  return problems;
}

function lineProblems(entries, check) {
  return entries.flatMap(({ line, text }) => check(text).map(message => ({ line, message })));
}

export function validateMarkdown(file, { root = ROOT, linksOnly = false, packageJson = null } = {}) {
  const text = readFileSync(file, 'utf8');
  const scan = scanMarkdown(text);
  const context = { file, root, text };
  const problems = lineProblems(scan.proseLines, line =>
    linkTargets(line)
      .map(target => checkLink(target, context))
      .filter(Boolean),
  );
  if (!linksOnly) {
    const pkg = packageJson ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const agents = basename(file) === 'AGENTS.md';
    const commands = [...scan.codeLines, ...scan.proseLines.map(({ line, text }) => ({ line, text: inlineCodeSpans(text).join('\n') }))];
    problems.push(...lineProblems(commands, line => npmProblems(line, pkg.scripts || {})));
    problems.push(...lineProblems(commands, line => scriptProblems(line, root)));
    problems.push(...lineProblems(scan.proseLines, line => inlineCodeSpans(line).flatMap(span => spanProblems(span, root))));
    problems.push(...nodeVersionProblems(scan, pkg.engines?.node, agents));
    if (agents) problems.push(...structureProblems(text, scan));
  }
  return problems.sort((a, b) => a.line - b.line);
}

function parseArgs(argv) {
  const options = { linksOnly: false, root: ROOT, files: [], help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--links-only') options.linksOnly = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--root' && argv[index + 1]) options.root = resolve(argv[++index]);
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else options.files.push(arg);
  }
  if (!options.files.length) options.files = ['AGENTS.md'];
  return options;
}

function expandFiles(patterns, root) {
  return patterns.flatMap(pattern => {
    if (!pattern.includes('*')) return [resolve(root, pattern)];
    const matches = globSync(pattern, { cwd: root }).map(match => resolve(root, match));
    return matches.length ? matches.sort() : [resolve(root, pattern)];
  });
}

export function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    stderr.write(`${error.message}\n${USAGE}\n`);
    return 2;
  }
  if (options.help) {
    stdout.write(`${USAGE}\n`);
    return 0;
  }
  let failures = 0;
  for (const file of expandFiles(options.files, options.root)) {
    const label = relative(options.root, file).split('\\').join('/');
    if (!existsSync(file)) {
      stderr.write(`${label}: file not found\n`);
      failures++;
      continue;
    }
    const problems = validateMarkdown(file, options);
    for (const { line, message } of problems) stderr.write(`${label}:${line}: ${message}\n`);
    failures += problems.length;
    if (!problems.length) stdout.write(`${label}: ok\n`);
  }
  return failures ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main();
