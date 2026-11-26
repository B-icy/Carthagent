import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sections } from './helpers/patch-sections.mjs';
import { CTG_RUNTIME_PATCH_SHA256, CTG_RUNTIME_SOURCE } from '../lib/opencode/runtime.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const candidatePath = 'docs/patches/opencode-v2.0.32-session-ui-combined-v22.patch';
const candidate = read(candidatePath);
const previous = read('docs/patches/opencode-v2.0.32-session-ui-combined-v21.patch');
const expected = '26b564635e1e2699797e72cf24a816952962bb392713d3812a98e4a3acb30711';
const portedUpstreamFixes = [
  'https://github.com/anomalyco/opencode/pull/65980',
  'https://github.com/anomalyco/opencode/pull/66471',
  'https://github.com/anomalyco/opencode/pull/66477',
];
const focusedSuites = [
  'test/plugin/promise-abort.test.ts test/plugin/promise-tool.test.ts test/plugin/session-remove.test.ts',
  'bun test --cwd packages/core test/config/plugin-source.test.ts',
  'bun test --cwd packages/ai test/executor.test.ts',
];
const portMarkers = {
  'packages/core/src/config/plugin/source.ts': ['ignore: ["node_modules", ".git", "**/{node_modules,.git}/**"]'],
  'packages/core/test/config/plugin-source.test.ts': [
    'ignores dependency and VCS trees inside a configured local plugin directory',
    '{ path: plugin, type: "directory", ignore: ["**/{node_modules,.git}/**", ".git", "node_modules"] }',
  ],
  'packages/ai/src/route/executor.ts': [
    'return parsed ? `${parsed.origin}${parsed.pathname}` : url.split(/[?#]/)[0]',
    'return `${fallback} (${request.method} ${requestTarget(request.url)})`',
  ],
  'packages/ai/test/executor.test.ts': [
    'shows the request method and URL without its query for empty error bodies',
    'expect(error.message).not.toContain("secret")',
    'Provider request failed with HTTP 502 (POST https://provider.test/v1/chat)',
  ],
};

test('v22 stages the ported upstream fixes without promoting the release pin', () => {
  assert.equal(digest(candidate), expected);
  assert.equal(digest(previous), CTG_RUNTIME_PATCH_SHA256);
  assert.equal(CTG_RUNTIME_PATCH_SHA256, '9a73eb1ded4d9914a554640226949d53caca986ef8b846ef8592fe75a9a1bf92');
  assert.notEqual(expected, CTG_RUNTIME_PATCH_SHA256);
  const release = JSON.parse(read('lib/opencode/runtime-release.json'));
  assert.equal(release.patchSha256, CTG_RUNTIME_PATCH_SHA256);
  assert.equal(release.sourceRevision, CTG_RUNTIME_SOURCE);
  assert.equal(CTG_RUNTIME_SOURCE, '843a6c514e606b436a7fe713422ace0a93ad3d61');
  const doc = read('docs/staged-native-upstream-v22.md');
  assert.ok(doc.includes(expected));
  for (const reference of portedUpstreamFixes) assert.ok(doc.includes(reference), reference);
  const build = read('script/ctg/build-owned-runtime.sh');
  assert.ok(build.includes(`EXPECTED_PATCH="${expected}"`));
  assert.ok(build.includes(candidatePath));
  for (const suite of focusedSuites) assert.ok(build.includes(suite), suite);
  assert.ok(read('.github/workflows/publish-owned-opencode-runtime.yml').includes(candidatePath));
});

test('v22 preserves v21 except for the ported upstream fixes and their focused regressions', () => {
  const before = sections(previous);
  const after = sections(candidate);
  assert.deepEqual(
    [...before.keys()].filter(path => before.get(path) !== after.get(path)),
    ['packages/plugin/src/promise/adapter.ts'],
  );
  assert.deepEqual(
    [...after.keys()].filter(path => !before.has(path)),
    [
      'packages/ai/src/route/executor.ts',
      'packages/ai/test/executor.test.ts',
      'packages/core/src/config/plugin/source.ts',
      'packages/core/test/config/plugin-source.test.ts',
      'packages/core/test/plugin/promise-abort.test.ts',
    ],
  );
  const adapter = after.get('packages/plugin/src/promise/adapter.ts');
  for (const marker of [
    'if (options?.signal?.aborted) return Promise.reject(options.signal.reason)',
    '{ signal: options?.signal }',
    'toolRuntimes.get(context.signal) ?? runtime',
    'toolRuntimes.set(signal, runtime)',
  ]) {
    assert.ok(adapter.includes(marker), marker);
  }
  const regression = after.get('packages/core/test/plugin/promise-abort.test.ts');
  for (const title of [
    'Promise plugins cannot remove a session with an aborted signal',
    'Promise plugin calls receive interruption while in flight',
    "a late abort preserves a completed Promise plugin call's error",
    'a late abort preserves completed success and other calls remain independent',
  ]) {
    assert.ok(regression.includes(title), title);
  }
  assert.ok(regression.includes('expect(error).toBe(controller.signal.reason)'));
  assert.ok(regression.includes('expect(calls.stopped).toBe(index + 1)'));
  assert.ok(regression.includes('toEqual([kept.id])'));
  for (const [path, markers] of Object.entries(portMarkers)) {
    for (const marker of markers) assert.ok(after.get(path).includes(marker), `${path}: ${marker}`);
  }
});
