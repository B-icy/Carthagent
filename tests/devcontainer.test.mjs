import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(join(root, path), 'utf8');

function parseJsonc(text) {
  let output = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      const end = stringEnd(text, index);
      output += text.slice(index, end);
      index = end;
    } else if (text.startsWith('//', index)) {
      index = text.indexOf('\n', index) === -1 ? text.length : text.indexOf('\n', index);
    } else if (text.startsWith('/*', index)) {
      const close = text.indexOf('*/', index + 2);
      assert.notEqual(close, -1, 'unterminated block comment');
      index = close + 2;
    } else {
      output += char;
      index++;
    }
  }
  return JSON.parse(output.replace(/,(\s*[}\]])/g, '$1'));
}

function stringEnd(text, start) {
  let index = start + 1;
  while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1;
  return index + 1;
}

const devcontainer = parseJsonc(read('.devcontainer/devcontainer.json'));
const dockerfile = read('.devcontainer/Dockerfile');
const ci = read('.github/workflows/ci.yml');
const packageJson = JSON.parse(read('package.json'));

test('JSONC parsing keeps comment-like text inside strings', () => {
  assert.deepEqual(parseJsonc('{\n  // note\n  "url": "https://example.com/*x*/", /* block */ "list": [1, 2,],\n}'), {
    url: 'https://example.com/*x*/',
    list: [1, 2],
  });
});

test('dev container uses a Node.js 24 base image allowed by package.json engines', () => {
  assert.equal(devcontainer.build.dockerfile, 'Dockerfile');
  const image = dockerfile.match(/^FROM\s+(\S+)/m)?.[1];
  assert.match(image, /^mcr\.microsoft\.com\/devcontainers\/javascript-node:(?:\d+-)?24(?:-|$)/);
  assert.match(packageJson.engines.node, /\^24\./);
});

test('dev container toolchain versions match CI', () => {
  const python = devcontainer.features['ghcr.io/devcontainers/features/python:1'].version;
  assert.match(ci, new RegExp(`python-version:\\s*"?${python.replace('.', '\\.')}"?`));
  assert.ok(devcontainer.features['ghcr.io/devcontainers/features/github-cli:1']);
  const bun = devcontainer.build.args.BUN_VERSION;
  assert.match(ci, new RegExp(`bun-version:\\s*${bun.replaceAll('.', '\\.')}`));
  assert.match(dockerfile, /ARG BUN_VERSION=\S+/);
  assert.equal(dockerfile.match(/ARG BUN_VERSION=(\S+)/)[1], bun);
  const pillow = devcontainer.postCreateCommand.match(/Pillow==([\d.]+)/)?.[1];
  assert.ok(pillow, 'postCreateCommand installs a pinned Pillow');
  assert.ok(ci.includes(`Pillow==${pillow}`), `CI installs Pillow ${pillow}`);
  assert.match(devcontainer.postCreateCommand, /^npm ci\b/);
});

test('dev container forwards the dashboard port and disables the update ping', () => {
  const defaultPort = Number(read('server.mjs').match(/CARTHAGENT_PORT \?\? (\d+)/)?.[1]);
  assert.ok(defaultPort, 'server.mjs default port');
  assert.ok(devcontainer.forwardPorts.includes(defaultPort));
  assert.ok(devcontainer.portsAttributes[String(defaultPort)]);
  assert.equal(devcontainer.containerEnv.CARTHAGENT_NO_UPDATE_CHECK, '1');
});

test('dev container editor setup matches the repository formatters and linters', () => {
  const { extensions, settings } = devcontainer.customizations.vscode;
  for (const id of ['dbaeumer.vscode-eslint', 'esbenp.prettier-vscode', 'ms-python.python']) assert.ok(extensions.includes(id), id);
  assert.equal(settings['editor.formatOnSave'], true);
  assert.equal(settings['editor.defaultFormatter'], 'esbenp.prettier-vscode');
  assert.equal(settings['eslint.useFlatConfig'], true);
  assert.ok(JSON.parse(read('.prettierrc.json')), 'Prettier config exists for prettier.requireConfig');
});
