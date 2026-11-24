import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { githubSlug, main, validateMarkdown } from '../tools/validate-agents-md.mjs';

const root = resolve(import.meta.dirname, '..');
const ENGINES = '^22.22.2 || ^24.15.0';

function fixtureRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ctg-agents-md-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const files = {
    'package.json': JSON.stringify({ engines: { node: ENGINES }, scripts: { test: 'node --test', check: 'node tools/check.mjs', 'test:python': 'x' } }),
    'bin/ctg.mjs': '',
    'tools/check.mjs': '',
    'lib/nested/delivery-review.mjs': '',
    'docs/guide.md': '# Guide\n\n## Running the `ctg` CLI\n\n<a id="custom-anchor"></a>\n',
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const GOOD = `# Working here

## Setup

Use Node.js matching \`package.json\` engines: \`${ENGINES}\`. Run \`npm ci\`.

## Development and verification

\`\`\`sh
npm run check
npm test
node --test tests/<area>.test.mjs
node bin/ctg.mjs demo
\`\`\`

See [the guide](docs/guide.md#running-the-ctg-cli), [anchor](docs/guide.md#custom-anchor),
[setup](#setup), \`lib/nested/\`, \`artifacts/qa/\` (generated output), \`delivery-review.mjs\`, \`tools/*.mjs\` and https://example.com.
Prose that mentions npm installation or \`~/.carthagent/\` is not a command or repo path.
`;

test('accepts a consistent AGENTS.md', t => {
  const dir = fixtureRepo(t);
  writeFileSync(join(dir, 'AGENTS.md'), GOOD);
  assert.deepEqual(validateMarkdown(join(dir, 'AGENTS.md'), { root: dir }), []);
});

test('reports each broken command, path, link, version and section precisely', t => {
  const dir = fixtureRepo(t);
  const bad = `# Notes

Use Node \`^20.0.0\`.

\`\`\`sh
npm run lint
npm start
npm frobnicate
node tools/missing.mjs --flag
python3 tools/absent.py
\`\`\`

See [gone](docs/gone.md), [bad anchor](docs/guide.md#nope), [self](#missing-heading),
\`docs/absent.md\`, \`lib/*.ts\` and \`ghost-file.json\`.
`;
  writeFileSync(join(dir, 'AGENTS.md'), bad);
  const problems = validateMarkdown(join(dir, 'AGENTS.md'), { root: dir }).map(({ line, message }) => `${line}: ${message}`);
  assert.deepEqual(problems, [
    '1: missing a Setup section heading',
    '1: missing a Development or verification section heading',
    `3: Node.js version \`^20.0.0\` does not match package.json engines \`${ENGINES}\``,
    '6: npm run lint: no "lint" script in package.json',
    '7: npm start: no "start" script in package.json',
    '8: npm frobnicate: not an npm command (did you mean npm run frobnicate?)',
    '9: node script tools/missing.mjs: does not exist',
    '10: python3 script tools/absent.py: does not exist',
    '13: broken link docs/gone.md: docs/gone.md does not exist',
    '13: broken link docs/guide.md#nope: no heading or anchor #nope',
    '13: broken link #missing-heading: no heading or anchor #missing-heading',
    '14: path docs/absent.md: does not exist',
    '14: path lib/*.ts: no files match',
    '14: path ghost-file.json: no file with this name in the repository',
  ]);
});

test('requires a Node.js version statement and minimum length in AGENTS.md only', t => {
  const dir = fixtureRepo(t);
  writeFileSync(join(dir, 'AGENTS.md'), '# Setup\n## Development\n');
  assert.deepEqual(
    validateMarkdown(join(dir, 'AGENTS.md'), { root: dir }).map(problem => problem.message),
    [`no Node.js version statement; expected \`${ENGINES}\` from package.json engines`, 'AGENTS.md is too short to be useful (100 characters or fewer)'],
  );
  writeFileSync(join(dir, 'docs', 'other.md'), '# Other\n\nRun `npm run nope` and see [x](missing.md).\n');
  assert.deepEqual(
    validateMarkdown(join(dir, 'docs', 'other.md'), { root: dir }).map(problem => problem.message),
    ['broken link missing.md: docs/missing.md does not exist', 'npm run nope: no "nope" script in package.json'],
  );
  assert.deepEqual(
    validateMarkdown(join(dir, 'docs', 'other.md'), { root: dir, linksOnly: true }).map(problem => problem.message),
    ['broken link missing.md: docs/missing.md does not exist'],
  );
});

test('GitHub heading slugs drop punctuation and keep hyphens', () => {
  assert.equal(githubSlug('Running the ctg CLI'), 'running-the-ctg-cli');
  assert.equal(githubSlug('Setup & layout: v1.2'), 'setup--layout-v12');
});

test('CLI prints file:line problems and exits non-zero; links-only accepts globs', t => {
  const dir = fixtureRepo(t);
  writeFileSync(join(dir, 'AGENTS.md'), GOOD.replace('npm run check', 'npm run missing'));
  let stderr = '';
  let stdout = '';
  const io = { stdout: { write: chunk => (stdout += chunk) }, stderr: { write: chunk => (stderr += chunk) } };
  assert.equal(main(['--root', dir], io), 1);
  assert.equal(stderr, 'AGENTS.md:10: npm run missing: no "missing" script in package.json\n');
  stderr = '';
  assert.equal(main(['--root', dir, '--links-only', 'docs/*.md'], io), 0);
  assert.equal(stdout, 'docs/guide.md: ok\n');
  assert.equal(main(['--bogus'], io), 2);
});

test('repository docs keep resolvable relative links', () => {
  let stderr = '';
  const io = { stdout: { write() {} }, stderr: { write: chunk => (stderr += chunk) } };
  assert.equal(main(['--root', root, '--links-only', 'docs/*.md', 'docs/api/*.md'], io), 0, stderr);
});
