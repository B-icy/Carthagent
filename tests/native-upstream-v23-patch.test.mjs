import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sections } from './helpers/patch-sections.mjs';
import { CTG_RUNTIME_PATCH_SHA256, CTG_RUNTIME_SOURCE } from '../lib/opencode/runtime.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const candidatePath = 'docs/patches/opencode-v2.0.32-session-ui-combined-v23.patch';
const candidate = read(candidatePath);
const previous = read('docs/patches/opencode-v2.0.32-session-ui-combined-v22.patch');
const expected = 'bd938d1600c06caadcf51267f962121e68e01f393d62ad8659e01ca9dea70516';
const portedUpstreamFixes = ['https://github.com/anomalyco/opencode/pull/66643'];
const focusedSuites = ['bun test --cwd packages/ai test/provider/openai-compatible-chat.test.ts'];
const portMarkers = {
  'packages/ai/src/protocols/openai-chat.ts': ['// Z.AI ends a response its safety review blocked with "sensitive".', 'case "sensitive":'],
  'packages/ai/test/provider/openai-compatible-chat.test.ts': [
    "maps Z.AI's sensitive finish to a content-filter finish",
    '{ normalized: "content-filter", raw: "sensitive" }',
  ],
};

test('v23 stages the ported upstream fixes without promoting the release pin', () => {
  assert.equal(digest(candidate), expected);
  assert.equal(digest(previous), '26b564635e1e2699797e72cf24a816952962bb392713d3812a98e4a3acb30711');
  assert.equal(CTG_RUNTIME_PATCH_SHA256, '9a73eb1ded4d9914a554640226949d53caca986ef8b846ef8592fe75a9a1bf92');
  assert.notEqual(expected, CTG_RUNTIME_PATCH_SHA256);
  const release = JSON.parse(read('lib/opencode/runtime-release.json'));
  assert.equal(release.patchSha256, CTG_RUNTIME_PATCH_SHA256);
  assert.equal(release.sourceRevision, CTG_RUNTIME_SOURCE);
  assert.equal(CTG_RUNTIME_SOURCE, '843a6c514e606b436a7fe713422ace0a93ad3d61');
  const doc = read('docs/staged-native-upstream-v23.md');
  assert.ok(doc.includes(expected));
  for (const reference of portedUpstreamFixes) assert.ok(doc.includes(reference), reference);
  const build = read('script/ctg/build-owned-runtime.sh');
  assert.ok(build.includes(`EXPECTED_PATCH="${expected}"`));
  assert.ok(build.includes(candidatePath));
  for (const suite of focusedSuites) assert.ok(build.includes(suite), suite);
  assert.ok(read('.github/workflows/publish-owned-opencode-runtime.yml').includes(candidatePath));
});

test('v23 preserves v22 except for the ported upstream fixes and their focused regressions', () => {
  const before = sections(previous);
  const after = sections(candidate);
  assert.deepEqual(
    [...before.keys()].filter(path => before.get(path) !== after.get(path)),
    ['packages/ai/src/protocols/openai-chat.ts'],
  );
  assert.deepEqual(
    [...after.keys()].filter(path => !before.has(path)),
    ['packages/ai/test/provider/openai-compatible-chat.test.ts'],
  );
  for (const [path, markers] of Object.entries(portMarkers)) {
    for (const marker of markers) assert.ok(after.get(path).includes(marker), `${path}: ${marker}`);
  }
});
