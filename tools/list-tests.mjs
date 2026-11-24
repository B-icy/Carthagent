#!/usr/bin/env node
import { globSync, readFileSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const DEFAULT_PATTERNS = ['tests/*.test.mjs'];
const SUITE_NAMES = new Set(['describe', 'suite']);
const TEST_NAMES = new Set(['test', 'it']);
const MODIFIERS = new Set(['skip', 'only', 'todo']);
const OPTION_MODIFIERS = ['skip', 'todo', 'only'];
const USAGE = `Usage: node tools/list-tests.mjs [--json] [file-or-glob ...]

Statically lists node:test tests (test, it, describe, suite, t.test and their
.skip/.only/.todo forms) without executing any test file.
Defaults to ${DEFAULT_PATTERNS.join(' ')}.`;

function scriptKind(fileName) {
  const ext = extname(fileName).toLowerCase();
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') return ts.ScriptKind.TS;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function classifyName(name, subtest) {
  if (SUITE_NAMES.has(name)) return 'suite';
  if (TEST_NAMES.has(name)) return 'test';
  if (subtest) return 'test';
  return null;
}

function calleeInfo(expression) {
  if (ts.isIdentifier(expression)) {
    const kind = classifyName(expression.text, false);
    return kind ? { kind, modifier: null } : null;
  }
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const property = expression.name.text;
  const target = expression.expression;
  if (MODIFIERS.has(property) && ts.isIdentifier(target)) {
    const kind = classifyName(target.text, false);
    return kind ? { kind, modifier: property } : null;
  }
  if (ts.isIdentifier(target) && !classifyName(target.text, false) && (property === 'test' || SUITE_NAMES.has(property))) {
    return { kind: classifyName(property, true), modifier: null, subtest: true };
  }
  return null;
}

function templateText(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return { name: node.text, dynamic: false };
  const parts = [node.head.text];
  for (const span of node.templateSpans) parts.push('${', span.expression.getText(), '}', span.literal.text);
  return { name: parts.join(''), dynamic: true };
}

function testName(argument) {
  if (!argument) return { name: '<anonymous>', dynamic: false };
  if (ts.isStringLiteral(argument)) return { name: argument.text, dynamic: false };
  if (ts.isNoSubstitutionTemplateLiteral(argument) || ts.isTemplateExpression(argument)) return templateText(argument);
  if (ts.isFunctionLike(argument) || ts.isObjectLiteralExpression(argument)) return { name: '<anonymous>', dynamic: false };
  return { name: `<${argument.getText()}>`, dynamic: true };
}

function optionModifier(call) {
  const options = call.arguments.find(argument => ts.isObjectLiteralExpression(argument));
  if (!options) return null;
  for (const property of options.properties) {
    const key = property.name && ts.isIdentifier(property.name) ? property.name.text : null;
    if (!OPTION_MODIFIERS.includes(key)) continue;
    const value = ts.isPropertyAssignment(property) ? property.initializer : null;
    if (value && value.kind === ts.SyntaxKind.FalseKeyword) continue;
    const conditional = !value || !(value.kind === ts.SyntaxKind.TrueKeyword || ts.isStringLiteralLike(value));
    return conditional ? `${key}?` : key;
  }
  return null;
}

export function listTestsInSource(source, fileName = 'test.mjs') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  const entries = [];
  const visit = (node, path) => {
    const info = ts.isCallExpression(node) ? calleeInfo(node.expression) : null;
    if (!info || (info.subtest && !node.arguments.some(argument => ts.isFunctionLike(argument)))) {
      ts.forEachChild(node, child => visit(child, path));
      return;
    }
    const { name, dynamic } = testName(node.arguments[0]);
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const modifier = info.modifier || optionModifier(node);
    entries.push({ type: info.kind, name, path: [...path], line, modifier, dynamic, subtest: Boolean(info.subtest) });
    for (const argument of node.arguments) visit(argument, [...path, name]);
  };
  visit(sourceFile, []);
  return entries;
}

export function expandPatterns(patterns, cwd = process.cwd()) {
  const files = new Set();
  const missing = [];
  for (const pattern of patterns) {
    const direct = resolve(cwd, pattern);
    let matches = [];
    try {
      if (statSync(direct).isFile()) matches = [direct];
    } catch {
      matches = globSync(pattern, { cwd }).map(match => resolve(cwd, match));
    }
    if (!matches.length) missing.push(pattern);
    for (const match of matches) files.add(match);
  }
  return { files: [...files].sort(), missing };
}

export function listTests(patterns = DEFAULT_PATTERNS, cwd = process.cwd()) {
  const { files, missing } = expandPatterns(patterns, cwd);
  const results = files.map(file => {
    const display = relative(cwd, file).split('\\').join('/');
    return { file: display, tests: listTestsInSource(readFileSync(file, 'utf8'), file) };
  });
  return { files: results, missing };
}

export function formatText(results) {
  const lines = [];
  let tests = 0;
  for (const { file, tests: entries } of results.files) {
    for (const entry of entries.filter(item => item.type === 'test')) {
      tests++;
      const suffix = entry.modifier ? ` [${entry.modifier}]` : '';
      lines.push(`${[file, ...entry.path, entry.name].join(' > ')}${suffix}`);
    }
  }
  lines.push(`${tests} tests in ${results.files.length} files`);
  return lines.join('\n');
}

function parseArgs(argv) {
  const options = { json: false, help: false, patterns: [] };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else options.patterns.push(arg);
  }
  if (!options.patterns.length) options.patterns = DEFAULT_PATTERNS;
  return options;
}

export function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr, cwd = process.cwd() } = {}) {
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
  const results = listTests(options.patterns, cwd);
  for (const pattern of results.missing) stderr.write(`No test files match: ${pattern}\n`);
  if (options.json) {
    const total = results.files.reduce((sum, file) => sum + file.tests.filter(entry => entry.type === 'test').length, 0);
    stdout.write(`${JSON.stringify({ total, files: results.files }, null, 2)}\n`);
  } else {
    stdout.write(`${formatText(results)}\n`);
  }
  return results.missing.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main();
