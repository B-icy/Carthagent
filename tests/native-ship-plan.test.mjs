import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { CTG_RUNTIME_PATCH_SHA256 } from '../lib/opencode/runtime.mjs';
import ts from 'typescript';
import { parseOpenCodeArgs } from '../lib/opencode/cli.mjs';
import { normalizeSessionOptions } from '../lib/opencode/session-options.mjs';

const patch = readFileSync(new URL('../docs/patches/opencode-v2.0.32-session-ui-combined-v3.patch', import.meta.url), 'utf8');
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

test('the runtime plan graph parser typechecks against the pinned native client API', () => {
  const virtualPath = fileURLToPath(new URL('.native-plan-items.ts', import.meta.url));
  const options = { noEmit: true, skipLibCheck: true, strict: true, target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const host = ts.createCompilerHost(options);
  const originalGet = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, createNew) => name === virtualPath ? ts.createSourceFile(name, source, languageVersion, true) : originalGet(name, languageVersion, onError, createNew);
  const program = ts.createProgram([virtualPath], options, host);
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


test('runtime source and build recipe pin the actual Ship graph patch bytes', () => {
  const digest = createHash('sha256').update(patch).digest('hex');
  assert.equal(CTG_RUNTIME_PATCH_SHA256, digest);
  const build = readFileSync(new URL('../script/ctg/build-owned-runtime.sh', import.meta.url), 'utf8');
  assert.ok(build.includes(`EXPECTED_PATCH="${digest}"`));
});
