import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sections } from './helpers/patch-sections.mjs';
import { CTG_RUNTIME_PATCH_SHA256, CTG_RUNTIME_SOURCE } from '../lib/opencode/runtime.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const candidatePath = 'docs/patches/opencode-v2.0.32-session-ui-combined-v24.patch';
const candidate = read(candidatePath);
const previous = read('docs/patches/opencode-v2.0.32-session-ui-combined-v23.patch');
const expected = '3fe2540c266ddb71c0b3dfb77c3c9945a1964479f2848c2233838b8f180d3a3a';
const portedUpstreamFixes = [
  'https://github.com/anomalyco/opencode/pull/66798',
  'https://github.com/anomalyco/opencode/pull/66796',
  'https://github.com/anomalyco/opencode/pull/66863',
];
const focusedSuites = [
  'bun test --cwd packages/ai test/provider-error.test.ts',
  'bun test --cwd packages/core test/session-error.test.ts',
  'bun test --cwd packages/tui test/plugin-structure.test.ts',
];
const portMarkers = {
  'packages/ai/src/provider-error.ts': [
    'const override = http !== undefined && http.status >= 400 ? http.headers["x-should-retry"] : undefined',
    "/input tokens exceeds? the model'?s? context limit/i,",
  ],
  'packages/ai/test/provider-error.test.ts': [
    'applies to failed responses, not streams that drop after a successful one',
    "classifies Tencent's 400003 passed through OpenCode Go as context overflow",
  ],
  'packages/core/test/session-error.test.ts': ['retries a stream that drops after a successful response that said not to retry'],
  'packages/core/test/session-runner.test.ts': ['error: { type: header ? "provider.rate-limit" : "provider.invalid-output" },'],
  'packages/tui/src/plugin/structure.ts': [
    'function validPath(path: string) {',
    'for (let index = path.lastIndexOf("."); index > 0; index = path.lastIndexOf(".", index - 1)) {',
  ],
  'packages/tui/test/plugin-structure.test.ts': ['suppresses slot claims targeting paths with empty segments without hanging'],
};

test('v24 stages the ported upstream fixes without promoting the release pin', () => {
  assert.equal(digest(candidate), expected);
  assert.equal(digest(previous), '50e92d9bb9a85ce7b70feec69871df6c1530e77149cda2bfb1fae8d0823f342c');
  assert.equal(CTG_RUNTIME_PATCH_SHA256, '9a73eb1ded4d9914a554640226949d53caca986ef8b846ef8592fe75a9a1bf92');
  assert.notEqual(expected, CTG_RUNTIME_PATCH_SHA256);
  const release = JSON.parse(read('lib/opencode/runtime-release.json'));
  assert.equal(release.patchSha256, CTG_RUNTIME_PATCH_SHA256);
  assert.equal(release.sourceRevision, CTG_RUNTIME_SOURCE);
  assert.equal(CTG_RUNTIME_SOURCE, '843a6c514e606b436a7fe713422ace0a93ad3d61');
  const doc = read('docs/staged-native-upstream-v24.md');
  assert.ok(doc.includes(expected));
  for (const reference of portedUpstreamFixes) assert.ok(doc.includes(reference), reference);
  const build = read('script/ctg/build-owned-runtime.sh');
  assert.ok(build.includes(`EXPECTED_PATCH="${expected}"`));
  assert.ok(build.includes(candidatePath));
  for (const suite of focusedSuites) assert.ok(build.includes(suite), suite);
  assert.ok(read('.github/workflows/publish-owned-opencode-runtime.yml').includes(candidatePath));
});

test('v24 preserves v23 except for the ported upstream fixes and their focused regressions', () => {
  const before = sections(previous);
  const after = sections(candidate);
  assert.deepEqual(
    [...before.keys()].filter(path => before.get(path) !== after.get(path)),
    [],
  );
  assert.deepEqual(
    [...after.keys()].filter(path => !before.has(path)),
    [
      'packages/ai/src/provider-error.ts',
      'packages/ai/test/provider-error.test.ts',
      'packages/core/test/session-error.test.ts',
      'packages/core/test/session-runner.test.ts',
      'packages/tui/src/plugin/structure.ts',
      'packages/tui/test/plugin-structure.test.ts',
    ],
  );
  for (const [path, markers] of Object.entries(portMarkers)) {
    for (const marker of markers) assert.ok(after.get(path).includes(marker), `${path}: ${marker}`);
  }
});
