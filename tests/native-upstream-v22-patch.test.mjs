import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CTG_RUNTIME_PATCH_SHA256, CTG_RUNTIME_SOURCE } from '../lib/opencode/runtime.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const candidatePath = 'docs/patches/opencode-v2.0.32-session-ui-combined-v22.patch';
const candidate = read(candidatePath);
const previous = read('docs/patches/opencode-v2.0.32-session-ui-combined-v21.patch');
const expected = 'ce3af84f6bba4c58255c160e897bab86508c917942de23d8b676f9ce589e31f5';
const portedUpstreamFixes = ['https://github.com/anomalyco/opencode/pull/65980'];

function sections(patch) {
  const entries = patch
    .split(/(?=^diff --git )/m)
    .filter(Boolean)
    .map(section => {
      const path = section.match(/^diff --git a\/(\S+) b\/\1\n/)?.[1];
      assert.ok(path?.startsWith('packages/') && !path.split('/').includes('..'), `unsafe patch path: ${path}`);
      return [path, section.replace(/^index .*\n/gm, '')];
    });
  assert.equal(new Set(entries.map(([path]) => path)).size, entries.length);
  return new Map(entries);
}

test('v22 stages the upstream Promise cancellation fix without promoting the release pin', () => {
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
  for (const reference of portedUpstreamFixes) assert.ok(doc.includes(reference));
  const build = read('script/ctg/build-owned-runtime.sh');
  assert.ok(build.includes(`EXPECTED_PATCH="${expected}"`));
  assert.ok(build.includes(candidatePath));
  assert.ok(build.includes('test/plugin/promise-abort.test.ts test/plugin/promise-tool.test.ts test/plugin/session-remove.test.ts'));
  assert.ok(read('.github/workflows/publish-owned-opencode-runtime.yml').includes(candidatePath));
});

test('v22 preserves v21 except for the Promise API adapter and its new focused regressions', () => {
  const before = sections(previous);
  const after = sections(candidate);
  assert.deepEqual(
    [...before.keys()].filter(path => before.get(path) !== after.get(path)),
    ['packages/plugin/src/promise/adapter.ts'],
  );
  assert.deepEqual(
    [...after.keys()].filter(path => !before.has(path)),
    ['packages/core/test/plugin/promise-abort.test.ts'],
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
});
