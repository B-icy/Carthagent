import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256, CTG_RUNTIME_PATCH_SHA256, readRuntimeReleaseManifest } from '../lib/opencode/runtime.mjs';
import { readPinnedOwnedRuntimeInputs } from '../tools/pinned-owned-runtime-inputs.mjs';
import ts from 'typescript';
import { parseOpenCodeArgs } from '../lib/opencode/cli.mjs';
import { normalizeSessionOptions } from '../lib/opencode/session-options.mjs';

const patch = readFileSync(new URL('../docs/patches/opencode-v2.0.32-session-ui-combined-v5.patch', import.meta.url), 'utf8');
const path = 'packages/tui/src/routes/session/plan-items.ts';
const section = patch.split(`diff --git a/${path} b/${path}\n`)[1]?.split('\ndiff --git ')[0];
assert.ok(section, 'the plan graph parser is part of the reproducible runtime patch');
const source = section.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1)).join('\n');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } });
const exports = {};
runInNewContext(compiled.outputText, { exports });
const items = messages => JSON.parse(JSON.stringify(exports.planItems(messages)));
const snapshot = (status = 'pending', revision = 1) => ({ runId: 'run-a', revision, items: [{ id: 'implementation', content: 'Implement the contract', status }] });
const message = (name, deliveryPlan, status = 'completed') => ({ type: 'assistant', content: [{ type: 'tool', name, state: { status, metadata: { deliveryPlan } } }] });

test('the runtime plan graph parser typechecks against the pinned native client API', t => {
  const directory = mkdtempSync(fileURLToPath(new URL('.native-plan-', import.meta.url)));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, 'plan-items.ts');
  writeFileSync(sourcePath, source);
  const options = { noEmit: true, skipLibCheck: true, strict: true, target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const program = ts.createProgram([sourcePath], options);
  const errors = ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  assert.deepEqual(errors, []);
});

test('direct and Code Mode graph entries use the latest server-authored snapshot', () => {
  assert.equal(items([message('carthagent_delivery_plan', snapshot())])[0].status, 'pending');
  assert.equal(items([message('carthagent_delivery_plan', snapshot()), message('execute', snapshot('active', 2))])[0].status, 'in_progress');
  assert.equal(items([message('execute', snapshot('done'))])[0].status, 'completed');
  assert.equal(items([message('execute', snapshot('failed'))])[0].status, 'failed');
});

test('failed and running tool calls cannot replace an accepted graph plan', () => {
  const accepted = message('execute', snapshot('active'));
  assert.equal(items([accepted, message('execute', snapshot('done'), 'error')])[0].status, 'in_progress');
  assert.equal(items([accepted, message('execute', snapshot('done'), 'running')])[0].status, 'in_progress');
  assert.deepEqual(items([{ type: 'assistant', content: [{ type: 'tool', name: 'todowrite', state: { status: 'completed', input: { todos: [{ content: 'not a contract' }] } } }] }]), []);
});

test('a new run replaces the graph rather than merging unrelated tasks', () => {
  const next = { runId: 'run-b', revision: 1, items: [{ id: 'new-task', content: 'New task', status: 'pending' }] };
  assert.deepEqual(items([message('execute', snapshot('done')), message('execute', next)]), [{ id: 'new-task', content: 'New task', status: 'pending' }]);
  assert.deepEqual(items([message('execute', snapshot()), message('execute', { ...next, items: [] })]), []);
  assert.deepEqual(items([message('execute', ['malformed'])]), []);
});

test('the runtime no longer owns a separate Ship agent or todowrite workflow', () => {
  const additions = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).join('\n');
  assert.doesNotMatch(additions, /CarthagentPlugin|todowrite|PROMPT_SHIP/);
});

test('native CLI preserves bounded-run and advisor controls in session options', () => {
  const parsed = parseOpenCodeArgs(['--protect-existing', '--rewrite-cap', '2', '--tool-output-cap', '4000', '--turn-delay-ms', '50', '--jev', '--jev-provider', 'ship', 'tui']);
  const normalized = normalizeSessionOptions(parsed);
  assert.deepEqual(normalized, { protectExisting: true, jev: true, rewriteCap: 2, toolOutputCap: 4000, turnDelayMs: 50, jevProvider: 'ship' });
  assert.equal(parseOpenCodeArgs(['--no-jev', 'tui']).jev, false);
});


test('development runtime source and preparation recipe pin the actual Ship graph patch bytes', () => {
  const digest = createHash('sha256').update(patch).digest('hex');
  assert.equal(CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256, digest);
  const prepare = readFileSync(new URL('../script/ctg/prepare-development-runtime.sh', import.meta.url), 'utf8');
  assert.ok(prepare.includes(`EXPECTED_PATCH="${digest}"`));
  assert.ok(prepare.includes('docs/patches/opencode-v2.0.32-session-ui-combined-v5.patch'));
  assert.doesNotMatch(prepare, /bun (install|run|build)|gh release|npm publish/);
});

const candidatePatchFile = 'docs/patches/opencode-v2.0.32-session-ui-combined-v5.patch';
const publishedPatchFile = 'docs/patches/opencode-v2.0.32-session-ui-combined-v4.patch';
const recipe = readFileSync(new URL('../script/ctg/build-owned-runtime.sh', import.meta.url), 'utf8');

test('the candidate release recipe builds the exact reviewed combined-v5 patch', async () => {
  const digest = createHash('sha256').update(readFileSync(new URL(`../${candidatePatchFile}`, import.meta.url))).digest('hex');
  assert.equal(digest, '8716b5f686fa733245f63e8036cc503bc628e16b79cd508b13925da4020738c6');
  assert.equal((recipe.match(/^EXPECTED_PATCH="([a-f0-9]{64})"$/m) ?? [])[1], digest);
  assert.equal((recipe.match(/^patch_file="\$ROOT\/([^"]+)"$/m) ?? [])[1], candidatePatchFile);
  const inputs = recipe.match(/^expected_inputs=\(\n([\s\S]*?)\n\)$/m)?.[1].split('\n').map(line => line.trim().replace(/^"|"$/g, ''));
  assert.deepEqual(inputs, [candidatePatchFile, 'script/ctg/build-owned-runtime.sh']);
  assert.doesNotMatch(recipe, /combined-v4/);
  const pinned = await readPinnedOwnedRuntimeInputs(fileURLToPath(new URL('..', import.meta.url)));
  assert.equal(pinned.patchSha256, digest);
  assert.equal(pinned.sourceRevision, '843a6c514e606b436a7fe713422ace0a93ad3d61');
  assert.equal(pinned.lockSha256, '9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d');
});

test('the candidate recipe runs test/sidebar and keeps the curated native regressions', () => {
  const tuiTests = recipe.split('\n').filter(line => line.startsWith('bun test --cwd packages/tui ')).join('\n');
  assert.match(tuiTests, /^bun test --cwd packages\/tui --timeout 30000 test\/sidebar$/m);
  for (const retained of [
    'test/navigation-rail.test.tsx --rerun-each 10', 'test/component/session-tabs-rail.test.tsx',
    'test/context/session-tabs-model.test.ts', 'test/ui/layout.test.ts', 'test/session-panel.test.tsx',
    'test/component/session-tabs-mouse.test.tsx', 'test/plugin-source.test.ts', 'test/clear-session.test.tsx',
  ]) assert.ok(tuiTests.includes(retained), `recipe retains ${retained}`);
  for (const pkg of ['core', 'server', 'plugin', 'client', 'tui']) assert.match(recipe, new RegExp(`^bun run --cwd packages/${pkg} typecheck$`, 'm'));
  assert.match(recipe, /^"\$binary" --version$/m);
  const sidebarFiles = [...patch.matchAll(/^diff --git a\/packages\/tui\/(test\/sidebar\/[^ ]+) /gm)].map(match => match[1]);
  assert.ok(sidebarFiles.length >= 7, 'the candidate patch supplies the sidebar test population');
  assert.ok(sidebarFiles.every(file => /\.test\.tsx?$/.test(file)));
});

test('published trust root stays on preview.12/v4 and rejects the candidate patch by default', async t => {
  const publishedDigest = createHash('sha256').update(readFileSync(new URL(`../${publishedPatchFile}`, import.meta.url))).digest('hex');
  assert.equal(CTG_RUNTIME_PATCH_SHA256, publishedDigest);
  assert.equal(CTG_RUNTIME_PATCH_SHA256, '1f2309bb3a31dfb8e8a0827a6a1144a1f76a005abff58f6f48857639ec02478a');
  assert.notEqual(CTG_RUNTIME_PATCH_SHA256, CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256);
  const manifestUrl = new URL('../lib/opencode/runtime-release.json', import.meta.url);
  const published = await readRuntimeReleaseManifest(fileURLToPath(manifestUrl));
  assert.equal(published.patchSha256, CTG_RUNTIME_PATCH_SHA256);
  assert.equal(published.releaseVersion, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  const directory = mkdtempSync(join(tmpdir(), 'ctg-published-trust-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const candidatePin = join(directory, 'runtime-release.json');
  writeFileSync(candidatePin, JSON.stringify({ ...published, patchSha256: CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256 }));
  await assert.rejects(readRuntimeReleaseManifest(candidatePin), /incompatible/i);
});
