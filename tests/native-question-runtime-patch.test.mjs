import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256, CTG_RUNTIME_LOCK_SHA256, CTG_RUNTIME_PATCH_SHA256, CTG_RUNTIME_SOURCE } from '../lib/opencode/runtime.mjs';

const releasedPath = 'docs/patches/opencode-v2.0.32-session-ui-combined-v15.patch';
const candidatePath = 'docs/patches/opencode-v2.0.32-session-ui-combined-v16.patch';
const promotedPath = 'docs/patches/opencode-v2.0.32-session-ui-combined-v21.patch';
const stagedPath = 'docs/patches/opencode-v2.0.32-session-ui-combined-v23.patch';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function additions(patch, path) {
  const marker = `diff --git a/${path} b/${path}\n`;
  const parts = patch.split(marker);
  assert.equal(parts.length, 2, `candidate must contain exactly one diff for ${path}`);
  return parts[1]
    .split('\ndiff --git ')[0]
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .map(line => line.slice(1))
    .join('\n');
}

test('v15 patch stays immutable; the 1.1.3 runtime pin selects reviewed v21', () => {
  assert.equal(sha256(read(releasedPath)), 'eb6feae3931d78a2ff572b63a2186c63f0300ca2ee4b7808d96bb270c65ec3f0');
  assert.equal(CTG_RUNTIME_PATCH_SHA256, sha256(read(promotedPath)));
  assert.equal(CTG_RUNTIME_PATCH_SHA256, '9a73eb1ded4d9914a554640226949d53caca986ef8b846ef8592fe75a9a1bf92');
  assert.equal(CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256, sha256(read('docs/patches/opencode-v2.0.32-session-ui-development-v20.patch')));
  const release = JSON.parse(read('lib/opencode/runtime-release.json'));
  assert.equal(release.patchSha256, CTG_RUNTIME_PATCH_SHA256);
  assert.equal(release.sourceRevision, CTG_RUNTIME_SOURCE);
  assert.equal(release.lockSha256, CTG_RUNTIME_LOCK_SHA256);
});

test('resolver and release trust root retain v21 while the source build stages v23', () => {
  const release = JSON.parse(read('lib/opencode/runtime-release.json'));
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(release.releaseVersion, packageJson.version);
  assert.equal(release.patchSha256, CTG_RUNTIME_PATCH_SHA256);
  assert.equal(release.sourceRevision, CTG_RUNTIME_SOURCE);
  assert.equal(release.lockSha256, CTG_RUNTIME_LOCK_SHA256);
  const build = read('script/ctg/build-owned-runtime.sh').toString('utf8');
  assert.notEqual(sha256(read(stagedPath)), release.patchSha256);
  assert.ok(build.includes(`EXPECTED_PATCH="${sha256(read(stagedPath))}"`));
  assert.ok(build.includes(stagedPath));
  assert.ok(read('.github/workflows/publish-owned-opencode-runtime.yml').toString('utf8').includes(stagedPath));
});

test('combined v16 is a separately identified source candidate, not an active runtime pin', t => {
  // Intentionally fail closed if the final patch or reviewed input hash is
  // absent. Do not skip this gate or manufacture candidate bytes to satisfy it.
  const candidate = read(candidatePath);
  const digest = sha256(candidate);
  const doc = read('docs/staged-native-question-forms.md').toString('utf8');
  const recorded = doc.match(/^Candidate patch SHA-256: `([a-f0-9]{64})`\.$/m)?.[1];
  assert.ok(recorded, 'replace the documentation input-hash placeholder after final source review');
  assert.equal(digest, recorded, 'documentation must identify the actual staged bytes');
  assert.notEqual(digest, CTG_RUNTIME_PATCH_SHA256);
  assert.notEqual(digest, CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256);
  assert.ok(doc.includes(CTG_RUNTIME_SOURCE));
  const text = candidate.toString('utf8');
  const paths = [...text.matchAll(/^diff --git a\/(\S+) b\/\1$/gm)].map(match => match[1]);
  assert.equal(new Set(paths).size, paths.length, 'one combined diff per source file, not concatenated patches');
  const released = read(releasedPath).toString('utf8');
  for (const match of released.matchAll(/^diff --git a\/(\S+) b\/\1$/gm)) {
    assert.ok(paths.includes(match[1]), `complete candidate retains released source path ${match[1]}`);
  }
  for (const path of paths) {
    assert.ok(path.startsWith('packages/'), `unexpected upstream patch path: ${path}`);
    assert.ok(!path.split('/').includes('..'), `unsafe upstream patch path: ${path}`);
  }
  t.diagnostic(`staged combined-v16 sha256=${digest}; structural checks are not source/runtime acceptance`);
});

test('combined v16 carries invocation-context adaptation and direct/nested question regressions', () => {
  const patch = read(candidatePath).toString('utf8');
  const adapter = additions(patch, 'packages/plugin/src/promise/adapter.ts');
  assert.match(adapter, /new WeakMap<AbortSignal, Context\.Context<never>>/);
  assert.match(adapter, /toolRuntimes\.set\(signal, runtime\)/);
  assert.match(adapter, /toolRuntimes\.get\(context\.signal\) \?\? runtime/);
  assert.match(adapter, /Effect\.runPromiseWith\(runtime\)\(context\.progress/);
  const regression = additions(patch, 'packages/core/test/plugin/promise-tool.test.ts');
  for (const marker of [
    '["missing", "different"]',
    '["direct", "nested-list", "nested-get", "question"]',
    'Context.omit(Location.Service)',
    'Context.Context<Effect.Services<typeof setup>>',
    'original(input, { ...invocation })',
    'expect(event.location).toEqual(owner.session.location)',
    'expect(event.data.form.sessionID).toBe(owner.session.id)',
    'expect(event.data.form.metadata).toEqual(',
    'concurrency: "unbounded"',
    'expect(yield* forms.list()).toEqual([])',
  ])
    assert.ok(regression.includes(marker), `missing invocation regression: ${marker}`);
});

test('combined v16 changes only the four reviewed files relative to v15', () => {
  // Full-index object IDs differ in formatting from v15, not source content.
  // Compare complete diff sections (including new files), ignoring only that
  // metadata line. Actual apply/tree equivalence is recorded independently.
  const sections = patch =>
    new Map(
      patch
        .split(/(?=^diff --git )/m)
        .filter(Boolean)
        .map(section => [section.split('\n')[0], section.replace(/^index .*\n/gm, '')]),
    );
  const released = sections(read(releasedPath).toString('utf8'));
  const candidate = sections(read(candidatePath).toString('utf8'));
  const changed = [...new Set([...released.keys(), ...candidate.keys()])].filter(key => released.get(key) !== candidate.get(key)).sort();
  const intended = [
    'packages/core/test/plugin/promise-tool.test.ts',
    'packages/plugin/src/promise/adapter.ts',
    'packages/tui/src/routes/session/form.tsx',
    'packages/tui/test/cli/tui/form.test.tsx',
  ]
    .map(path => `diff --git a/${path} b/${path}`)
    .sort();
  assert.deepEqual(changed, intended);
  const newFiles = [...released].filter(([, section]) => /^new file mode /m.test(section));
  assert.equal(newFiles.length, 40, 'all reviewed untracked upstream files remain in the complete patch');
  for (const [key, section] of newFiles) assert.equal(candidate.get(key), section, key);
});

test('combined v16 carries bounded form scrolling and interaction regressions', () => {
  const patch = read(candidatePath).toString('utf8');
  const form = additions(patch, 'packages/tui/src/routes/session/form.tsx');
  for (const marker of ['<scrollbox', 'id="form-body"', 'maxHeight={bodyMaxHeight()}', 'dimensions().height', 'pgup/pgdn scroll', 'body?.scrollTo(0)']) {
    assert.ok(form.includes(marker), `missing bounded form implementation: ${marker}`);
  }
  const regression = additions(patch, 'packages/tui/test/cli/tui/form.test.tsx');
  for (const marker of [
    'long form pages without losing choices',
    '[120, 40]',
    '[90, 28]',
    '[70, 22]',
    'reveals an offscreen choice before activating it',
    'long email field remains editable, validates, and resets scrolling on review',
    'long multiselect reaches custom input and confirmation',
    'long external instructions page to the URL without acknowledging it',
    'confirmation scrolls with arrows and pages after a terminal resize',
    'custom choice follows consecutive fields with different option counts',
    'growing custom editor remains visible',
    'expect(prompt.replies).toEqual([])',
    'mockMouse.scroll',
    'café 日本語',
  ])
    assert.ok(regression.includes(marker), `missing form regression: ${marker}`);
});
