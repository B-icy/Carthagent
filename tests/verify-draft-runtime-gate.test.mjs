import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REQUIRED_RELEASE_ASSETS, verifyDraftRuntimeGate } from '../tools/verify-draft-runtime-gate.mjs';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tag = `v${version}`;
const sha = 'a'.repeat(40);
const producerReleaseAssets = [
  'opencode-linux-x64.tar.gz',
  'opencode-linux-arm64.tar.gz',
  'opencode-darwin-x64.tar.gz',
  'opencode-darwin-arm64.tar.gz',
  'opencode-windows-x64.tar.gz',
  'runtime-release.json',
  'runtime-release-SHA256SUMS.txt',
].map((name) => ({ name }));
const release = { id: 77, tag_name: tag, draft: true, assets: producerReleaseAssets };

function mockRun({ releaseValue = release, remoteSha = sha, checkoutSha = sha, annotated = false } = {}) {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    if (command === 'git' && args[0] === 'rev-parse') return `${checkoutSha}\n`;
    if (command !== 'gh') throw new Error(`Unexpected fake command ${command} ${args.join(' ')}`);
    if (args[0] === 'api' && args[1] === `repos/B-icy/Carthagent/git/ref/tags/${tag}`) return JSON.stringify({ object: { type: annotated ? 'tag' : 'commit', sha: annotated ? 'c'.repeat(40) : remoteSha } });
    if (args[0] === 'api' && args[1] === `repos/B-icy/Carthagent/git/tags/${'c'.repeat(40)}`) return JSON.stringify({ object: { type: 'commit', sha: remoteSha } });
    if (args[0] === 'api' && args[1] === '--paginate' && args[2] === '--slurp' && args[3] === 'repos/B-icy/Carthagent/releases?per_page=100') return JSON.stringify([[releaseValue]]);
    throw new Error(`Unexpected fake GitHub API call ${args.join(' ')}`);
  };
  return { run, calls };
}

test('accepts only the exact draft and returns its release ID and pinned commit', async () => {
  const { run, calls } = mockRun();
  const result = await verifyDraftRuntimeGate({ phase: 'before', releaseTag: tag, repo: 'B-icy/Carthagent', cwd: '/fixture', run });
  assert.deepEqual(result, { releaseId: 77, sha, version });
  assert.equal(calls.filter(([command]) => command === 'gh').length, 2);
});

test('resolves an annotated tag object to the exact commit before acceptance', async () => {
  const { run, calls } = mockRun({ annotated: true });
  const result = await verifyDraftRuntimeGate({ phase: 'before', releaseTag: tag, repo: 'B-icy/Carthagent', cwd: '/fixture', run });
  assert.equal(result.sha, sha);
  assert.equal(calls.some(([, args]) => args?.[1] === `repos/B-icy/Carthagent/git/tags/${'c'.repeat(40)}`), true);
});

test('rejects a malformed tag before invoking git or GitHub', async () => {
  const { run, calls } = mockRun();
  await assert.rejects(verifyDraftRuntimeGate({ phase: 'before', releaseTag: `not-${tag}`, repo: 'B-icy/Carthagent', run }), /must be exactly/);
  assert.equal(calls.length, 0);
});

test('rejects a stale/moved tag before installed acceptance', async () => {
  const { run, calls } = mockRun({ remoteSha: 'b'.repeat(40) });
  await assert.rejects(verifyDraftRuntimeGate({ phase: 'before', releaseTag: tag, repo: 'B-icy/Carthagent', cwd: '/fixture', run }), /but this checkout is/);
  assert.equal(calls.some(([command]) => command === 'git'), true);
});

test('rejects a published release before installed acceptance', async () => {
  const { run, calls } = mockRun({ releaseValue: { ...release, draft: false } });
  await assert.rejects(verifyDraftRuntimeGate({ phase: 'before', releaseTag: tag, repo: 'B-icy/Carthagent', run }), /must remain a draft/);
  assert.equal(calls.some(([, args]) => args?.[1]?.includes('/git/ref/')), false);
});

test('requires the exact seven-asset producer contract: five archives, manifest, and combined checksums', async () => {
  const expectedAssets = [
    'opencode-linux-x64.tar.gz',
    'opencode-linux-arm64.tar.gz',
    'opencode-darwin-x64.tar.gz',
    'opencode-darwin-arm64.tar.gz',
    'opencode-windows-x64.tar.gz',
    'runtime-release.json',
    'runtime-release-SHA256SUMS.txt',
  ];
  assert.deepEqual(REQUIRED_RELEASE_ASSETS, expectedAssets);
  const result = await verifyDraftRuntimeGate({
    phase: 'before', releaseTag: tag, repo: 'B-icy/Carthagent', cwd: '/fixture',
    run: mockRun({ releaseValue: { ...release, assets: expectedAssets.map((name) => ({ name })) } }).run,
  });
  assert.deepEqual(result, { releaseId: 77, sha, version });

  for (const [label, assets, expected] of [
    ['missing manifest', release.assets.filter(({ name }) => name !== 'runtime-release.json'), /exactly one runtime-release\.json asset/],
    ['duplicate platform archive', [...release.assets, { name: REQUIRED_RELEASE_ASSETS[0] }], /exactly one opencode-linux-x64\.tar\.gz asset/],
    ['unexpected extra asset', [...release.assets, { name: 'unreviewed-runtime.tar.gz' }], /unexpected assets: unreviewed-runtime\.tar\.gz/],
    ['renamed checksum asset', release.assets.map((asset) => asset.name === 'runtime-release-SHA256SUMS.txt' ? { name: 'SHA256SUMS.txt' } : asset), /exactly one runtime-release-SHA256SUMS\.txt asset/],
  ]) {
    const { run } = mockRun({ releaseValue: { ...release, assets } });
    await assert.rejects(verifyDraftRuntimeGate({ phase: 'before', releaseTag: tag, repo: 'B-icy/Carthagent', run }), expected, label);
  }
});

test('the workflow precheck command fails before acceptance for malformed tag, moved tag, or published release', async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'ctg-draft-gate-fake-gh-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const requestsLog = path.join(temp, 'gh-requests');
  const releaseFile = path.join(temp, 'release.json');
  const targetFile = path.join(temp, 'target-sha');
  const preloadFile = path.join(temp, 'fake-gh-preload.mjs');
  const currentSha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  await writeFile(targetFile, currentSha);
  await writeFile(releaseFile, JSON.stringify(release));
  await writeFile(preloadFile, `
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const originalSpawnSync = childProcess.spawnSync;
childProcess.spawnSync = function(command, args, options) {
  if (command !== 'gh') return originalSpawnSync.call(this, command, args, options);
  fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + '\\n');
  let stdout;
  if (args.some(value => value.includes('/releases?per_page=100'))) {
    stdout = JSON.stringify([[JSON.parse(fs.readFileSync(process.env.FAKE_RELEASE_JSON, 'utf8'))]]);
  } else if (args.some(value => value.includes('/git/ref/tags/'))) {
    stdout = JSON.stringify({ object: { type: 'commit', sha: fs.readFileSync(process.env.FAKE_TARGET_SHA, 'utf8').trim() } });
  } else {
    return { status: 2, stdout: '', stderr: 'Unexpected fake GitHub API call', error: undefined };
  }
  return { status: 0, stdout, stderr: '', error: undefined };
};
syncBuiltinESMExports();
`);
  const tool = fileURLToPath(new URL('../tools/verify-draft-runtime-gate.mjs', import.meta.url));
  const invoke = (tagValue) => spawnSync(process.execPath, [tool, 'before', tagValue], {
    cwd: path.resolve('.'), encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(preloadFile).href}`.trim(),
      GITHUB_REPOSITORY: 'B-icy/Carthagent', GITHUB_OUTPUT: path.join(temp, 'github-output'),
      FAKE_GH_LOG: requestsLog, FAKE_RELEASE_JSON: releaseFile, FAKE_TARGET_SHA: targetFile,
    },
  });

  const malformed = invoke('not-a-version');
  assert.notEqual(malformed.status, 0);
  await assert.rejects(readFile(requestsLog));

  await writeFile(targetFile, 'b'.repeat(40));
  const stale = invoke(tag);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /but this checkout is/);

  await writeFile(targetFile, currentSha);
  await writeFile(releaseFile, JSON.stringify({ ...release, draft: false }));
  const published = invoke(tag);
  assert.notEqual(published.status, 0);
  assert.match(published.stderr, /must remain a draft/);
});

test('trusted inline bootstrap accepts a main tag and rejects non-main dispatch and a foreign tag', async (t) => {
  const workflow = (await readFile(new URL('../.github/workflows/accept-draft-release.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const bootstrap = workflow.match(/- name: Require main dispatch and a release tag descended from origin\/main[\s\S]*?\n        run: \|\n((?:          .*\n)+)/)?.[1];
  const postcheck = workflow.match(/- name: Reverify release tag ancestry against approved main after acceptance[\s\S]*?\n        run: \|\n((?:          .*\n?)+?)(?=\n      - |\n\s*$)/)?.[1];
  assert.ok(bootstrap, 'trusted ancestry bootstrap block must be extractable');
  assert.ok(postcheck, 'post-acceptance trusted ancestry block must be extractable');

  const temp = await mkdtemp(path.join(tmpdir(), 'ctg-main-ancestry-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source');
  const bare = path.join(temp, 'origin.git');
  const output = path.join(temp, 'github-output');
  const fixtureVersion = '1.0.3';
  const fixtureTag = `v${fixtureVersion}`;
  await mkdir(source);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
  git(source, 'init', '-b', 'main');
  git(source, 'config', 'user.email', 'gate-fixture@example.invalid');
  git(source, 'config', 'user.name', 'Gate Fixture');
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ version: fixtureVersion }));
  git(source, 'add', 'package.json');
  git(source, 'commit', '-m', 'approved main release commit');
  const approvedSha = git(source, 'rev-parse', 'HEAD');
  git(source, 'tag', '-a', fixtureTag, '-m', 'approved annotated draft release', approvedSha);
  execFileSync('git', ['init', '--bare', bare], { stdio: 'pipe' });
  git(source, 'remote', 'add', 'origin', bare);
  git(source, 'push', 'origin', 'main', '--tags');

  const bashPath = (value) => {
    if (process.platform !== 'win32') return value;
    return execFileSync('cygpath', ['-u', value], { encoding: 'utf8' }).trim();
  };
  const invoke = (script, ref, expectedSha = '') => spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
    cwd: source, encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_REF: ref,
      GITHUB_OUTPUT: bashPath(output),
      RELEASE_TAG: fixtureTag,
      TRUSTED_REPOSITORY_URL: bashPath(bare),
      EXPECTED_SHA: expectedSha,
    },
  });

  const accepted = invoke(bootstrap, 'refs/heads/main');
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(await readFile(output, 'utf8'), new RegExp(`sha=${approvedSha}`));
  assert.equal(invoke(bootstrap, 'refs/heads/release-candidate').status, 1);
  assert.equal(invoke(postcheck, 'refs/heads/main', approvedSha).status, 0);

  git(source, 'checkout', '-b', 'foreign/release');
  await writeFile(path.join(source, 'foreign.txt'), 'not in main');
  git(source, 'add', 'foreign.txt');
  git(source, 'commit', '-m', 'unapproved foreign release commit');
  git(source, 'tag', '-f', fixtureTag, 'HEAD');
  git(source, 'push', 'origin', `+refs/tags/${fixtureTag}:refs/tags/${fixtureTag}`);
  const rejectedForeign = invoke(bootstrap, 'refs/heads/main');
  assert.equal(rejectedForeign.status, 1, rejectedForeign.stderr);
  assert.match(rejectedForeign.stderr, /must point to a commit descended from approved origin\/main/);
  const rejectedMovedTag = invoke(postcheck, 'refs/heads/main', approvedSha);
  assert.equal(rejectedMovedTag.status, 1, rejectedMovedTag.stderr);
  assert.match(rejectedMovedTag.stderr, /moved during acceptance/);
});

test('post-check requires the same release ID and the pre-acceptance tested SHA', async () => {
  const { run: goodRun } = mockRun();
  assert.deepEqual(await verifyDraftRuntimeGate({ phase: 'after', releaseTag: tag, expectedSha: sha, expectedReleaseId: 77, repo: 'B-icy/Carthagent', cwd: '/fixture', run: goodRun }), {
    releaseId: 77, sha, version,
  });
  const { run: movedRun } = mockRun({ remoteSha: 'b'.repeat(40) });
  await assert.rejects(verifyDraftRuntimeGate({ phase: 'after', releaseTag: tag, expectedSha: sha, expectedReleaseId: 77, repo: 'B-icy/Carthagent', cwd: '/fixture', run: movedRun }), /but this checkout is/);
  const { run: idRun } = mockRun({ releaseValue: { ...release, id: 78 } });
  await assert.rejects(verifyDraftRuntimeGate({ phase: 'after', releaseTag: tag, expectedSha: sha, expectedReleaseId: 77, repo: 'B-icy/Carthagent', run: idRun }), /identity changed/);
});

test('immediate pre-acceptance recheck pins the original SHA and release ID', async () => {
  const { run } = mockRun();
  assert.deepEqual(await verifyDraftRuntimeGate({ phase: 'recheck', releaseTag: tag, expectedSha: sha, expectedReleaseId: 77, repo: 'B-icy/Carthagent', cwd: '/fixture', run }), {
    releaseId: 77, sha, version,
  });
  await assert.rejects(verifyDraftRuntimeGate({ phase: 'recheck', releaseTag: tag, expectedSha: 'b'.repeat(40), expectedReleaseId: 77, repo: 'B-icy/Carthagent', cwd: '/fixture', run }), /changed during acceptance/);
  await assert.rejects(verifyDraftRuntimeGate({ phase: 'recheck', releaseTag: tag, expectedSha: sha, expectedReleaseId: 76, repo: 'B-icy/Carthagent', cwd: '/fixture', run }), /identity changed/);
});

test('draft workflow grants required push capability but performs only read operations', async () => {
  const workflow = await readFile(new URL('../.github/workflows/accept-draft-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /permissions:\s*\n\s+contents:\s+read/);
  assert.match(workflow, /jobs:[\s\S]*?permissions:\s*\n\s+contents:\s+write/);
  assert.match(workflow, /draft releases only to callers with push access/i);
  assert.match(workflow, /minimum GITHUB_TOKEN capability/i);
  assert.match(workflow, /token only for GETs/i);
  const acceptance = workflow.match(/- name: Run the current full non-focused installed-package gate through the default resolver([\s\S]*?\n\s+run: npm run test:native-package)/)?.[0];
  assert.ok(acceptance);
  assert.match(acceptance, /CTG_REQUIRE_OWNED_RUNTIME:\s*['"]?1/);
  assert.match(acceptance, /CTG_RUNTIME_GITHUB_TOKEN:\s*\$\{\{ github\.token \}\}/);
  assert.match(acceptance, /GH_TOKEN:\s*['"]{2}/);
  assert.match(workflow, /run: npm run test:native-package/);
  assert.doesNotMatch(workflow, /gh release (?:create|upload|edit)|releases\/assets|curl .*cli\/releases/);
  assert.doesNotMatch(workflow, /gh api\s+(?:--[^\n]*\s+)?--method\s+(?:POST|PATCH|PUT|DELETE)|gh api\s+-X\s+(?:POST|PATCH|PUT|DELETE)/i);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run quality/);
  assert.match(workflow, /verify-draft-runtime-gate\.mjs before/);
  assert.match(workflow, /verify-draft-runtime-gate\.mjs recheck/);
  assert.match(workflow, /verify-draft-runtime-gate\.mjs after/);
  assert.match(workflow, /verify release tag ancestry against approved main after acceptance/);
  const bootstrapIndex = workflow.indexOf('Require main dispatch and a release tag descended from origin/main');
  const checkoutIndex = workflow.indexOf('uses: actions/checkout@v4');
  const verifierIndex = workflow.indexOf('verify-draft-runtime-gate.mjs before');
  assert.ok(bootstrapIndex >= 0 && bootstrapIndex < checkoutIndex && checkoutIndex < verifierIndex,
    'trusted inline ancestry bootstrap must run before release checkout and tag-sourced verifier');
  assert.match(workflow, /ref:\s*\$\{\{ steps\.trusted-ancestry\.outputs\.sha \}\}/,
    'checkout must use the trusted ancestry-checked SHA, not resolve the mutable tag again');
  const docs = (await readFile(new URL('../docs/opencode-owned-runtime.md', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(docs, /current full,\s+non-focused installed-package gate/);
  assert.match(docs, /exactly those seven assets/);
  assert.match(docs, /independently reviewed host-controls, glyph,\s+controlled-terminal semantics, and visual-clear\/reopen probes are now composed\s+into that gate/);
  assert.match(docs, /Their live final-artifact results remain pending/);
});

test('published release workflow explicitly empties optional draft credentials for public acceptance', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const acceptance = workflow.match(/- name: Accept the installed package with its owned runtime required([\s\S]*?)(?=\n      - |\n\s+run:)/)?.[1];
  const verify = workflow.match(/- name: Verify runtime archives against the packaged immutable manifest([\s\S]*?)(?=\n      - |\n\s+run:)/)?.[1];
  assert.match(acceptance ?? '', /CTG_RUNTIME_GITHUB_TOKEN:\s*['"]{2}/);
  assert.match(verify ?? '', /CTG_RUNTIME_GITHUB_TOKEN:\s*['"]{2}/);
});
