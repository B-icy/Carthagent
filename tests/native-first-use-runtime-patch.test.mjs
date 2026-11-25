import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sections } from './helpers/patch-sections.mjs';
import { CTG_RUNTIME_PATCH_SHA256, CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256, CTG_RUNTIME_SOURCE } from '../lib/opencode/runtime.mjs';

const baselinePath = 'docs/patches/opencode-v2.0.32-session-ui-combined-v16.patch';
const candidatePath = 'docs/patches/opencode-v2.0.32-session-ui-combined-v17.patch';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');

test('first-use staging preserves the immutable v16 patch', () => {
  const baselineDoc = read('docs/staged-native-question-forms.md');
  const expected = baselineDoc.match(/^Candidate patch SHA-256: `([a-f0-9]{64})`\.$/m)?.[1];
  assert.ok(expected);
  assert.equal(digest(read(baselinePath)), expected);
  // v15/v16 structural comparisons remain in native-question-runtime-patch;
  // its prebuild guards select the current reviewed recipe.
});

test('combined v17 has its own reviewed digest and is not an active runtime pin', t => {
  const candidate = read(candidatePath);
  const doc = read('docs/staged-native-first-use.md');
  const expected = doc.match(/^Candidate patch SHA-256: `([a-f0-9]{64})`\.$/m)?.[1];
  assert.ok(expected, 'final source handoff must replace the candidate hash placeholder');
  assert.equal(digest(candidate), expected);
  assert.notEqual(expected, digest(read(baselinePath)));
  assert.notEqual(expected, CTG_RUNTIME_PATCH_SHA256);
  assert.notEqual(expected, CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256);
  assert.ok(doc.includes(CTG_RUNTIME_SOURCE));
  t.diagnostic(`staged combined-v17 sha256=${expected}; structural evidence only`);
});

test('combined v17 changes only the final reviewed first-use paths and preserves the remaining v16 inventory', () => {
  const doc = read('docs/staged-native-first-use.md');
  const block = doc.match(/<!-- reviewed-delta-paths -->\n```json\n([\s\S]*?)\n```/);
  assert.ok(block, 'documentation must carry the reviewed final delta allowlist');
  const allowed = JSON.parse(block[1]);
  assert.ok(Array.isArray(allowed) && allowed.length > 0, 'final path inventory is pending; do not infer it from active workers');
  assert.ok(allowed.every(path => typeof path === 'string' && path.startsWith('packages/tui/') && !path.split('/').includes('..')));
  assert.equal(new Set(allowed).size, allowed.length);
  assert.deepEqual([...allowed].sort(), [
    'packages/tui/src/component/dialog-model.tsx',
    'packages/tui/src/component/prompt/metadata.tsx',
    'packages/tui/src/routes/home.tsx',
    'packages/tui/test/cloud-onboarding.test.tsx',
    'packages/tui/test/command-selection.test.tsx',
    'packages/tui/test/feature-plugins/prompt-footer.test.tsx',
  ]);
  const baseline = sections(read(baselinePath));
  const candidate = sections(read(candidatePath));
  for (const path of baseline.keys()) assert.ok(candidate.has(path), `complete patch lost baseline path: ${path}`);
  const changed = [...new Set([...baseline.keys(), ...candidate.keys()])].filter(path => baseline.get(path) !== candidate.get(path)).sort();
  assert.deepEqual(changed, [...allowed].sort());
  const added = [...baseline].filter(([, section]) => /^new file mode /m.test(section));
  assert.equal(added.length, 40, 'reviewed v16 added-file inventory must stay complete');
  for (const [path, section] of added) {
    assert.ok(candidate.has(path), `lost reviewed source file: ${path}`);
    // cloud-onboarding is already one of the 40 additions and intentionally
    // changes here. Any other change still requires the explicit allowlist.
    if (!allowed.includes(path)) assert.equal(candidate.get(path), section, path);
  }
});

test('combined v17 includes first-use recovery and allocated-width renderer regressions', () => {
  const candidate = sections(read(candidatePath));
  const home = candidate.get('packages/tui/src/routes/home.tsx');
  assert.match(home, /Explain this repo and how to run its tests\./);
  assert.match(home, /Ship plans and checks changes\. Quick runs without required checks\./);
  assert.match(home, /Use your own provider: \/connect/);
  const picker = candidate.get('packages/tui/src/component/dialog-model.tsx');
  assert.match(picker, /Connect a provider to get started/);
  assert.match(picker, /noMatchView=\{models\(\)\.length === 0 \? emptyView\(\) : undefined\}/);
  const metadata = candidate.get('packages/tui/src/component/prompt/metadata.tsx');
  assert.match(metadata, /onSizeChange=/);
  assert.match(metadata, /queueMicrotask\(\(\) => setWidth\(width\)\)/);
  assert.match(metadata, /\{chromeGlyph\("·"\)\} \{provider\(\)\}/);
  const onboarding = candidate.get('packages/tui/test/cloud-onboarding.test.tsx');
  assert.match(onboarding, /\[120, 36\]/);
  assert.match(onboarding, /\[80, 24\]/);
  assert.match(onboarding, /loading\)\.not\.toContain\("Continue with Carthagent Cloud"\)/);
  assert.match(candidate.get('packages/tui/test/command-selection.test.tsx'), /model picker distinguishes unmatched searches/);
  const footer = candidate.get('packages/tui/test/feature-plugins/prompt-footer.test.tsx');
  assert.match(footer, /badge\.x \+ badge\.width\)\.toBeLessThanOrEqual\(send\.x\)/);
  assert.match(footer, /send\.x \+ send\.width\)\.toBeLessThanOrEqual\(width - 4\)/);
});
