import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Self-review defaults persist to ~/.pi2/config.json — isolate tests from the
// real user config before any extension code reads it.
process.env.PI2_CONFIG = join(mkdtempSync(join(tmpdir(), 'pi2 test config ')), 'config.json');
const candidates = [
  process.env.PI2_CLI,
  process.env.PI_CLI,
  join(root, 'vendor', 'agent', 'cli.js')
].filter(Boolean);
const cli = candidates.find(existsSync);
let factory;
if (cli) {
  try {
    const requirePi = createRequire(cli);
    const { createJiti } = requirePi('jiti');
    const jiti = createJiti(import.meta.url, { alias: { typebox: requirePi.resolve('typebox'), '@earendil-works/pi-coding-agent': join(root, 'tests', 'engine-api.mjs') } });
    factory = await jiti.import(join(root, 'extensions', 'delivery.ts'), { default: true });
  } catch { /* toolchain (jiti/typebox devDeps) unavailable — tests skip below */ }
}
const options = { skip: !factory && 'Agent engine or dev toolchain not found: run npm install to enable extension integration tests' };
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'pi extension integration '));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  // Per-fixture self-review config so /review mode writes stay isolated.
  process.env.PI2_CONFIG = join(cwd, 'config.json');
  writeFileSync(join(cwd, 'app.py'), 'print(1)');
  const hooks = {}, tools = {}, commands = {}, entries = [], messages = [], flags = { 'delivery-strict': true };
  const pi = {
    registerFlag() {}, getFlag: name => flags[name],
    on(name, fn) { hooks[name] = fn; },
    registerTool(tool) { tools[tool.name] = tool; },
    registerCommand(name, command) { commands[name] = command; },
    appendEntry(customType, data) { entries.push({ type: 'custom', customType, data }); },
    sendMessage(message) { messages.push(message); },
  };
  factory(pi);
  const ctx = { cwd, hasUI: false, mode: 'rpc', ui: { notify() {}, select: async () => undefined }, sessionManager: { getBranch: () => entries, getSessionId: () => 'integration-session' }, hasPendingMessages: () => false };
  const call = (name, params = {}) => tools[name].execute('test-id', params, undefined, undefined, ctx);
  const plan = { goal: 'Working script', assumptions: [], artifacts: ['app.py'], steps: ['Implement', 'Verify'], acceptance: [{ requirement: 'Runs', checks: ['run'] }], checks: [{ id: 'run', kind: 'runtime', argv: [process.execPath, '-e', 'console.log("passed")'], timeoutSeconds: 5 }] };
  return { cwd, ctx, hooks, commands, entries, messages, flags, call, plan };
}

test('real extension loads, gates writes, executes checks and rejects stale evidence', options, async t => {
  const f = fixture(t);
  assert.equal(f.hooks.tool_call({ toolName: 'write' }).block, true);
  assert.equal(f.hooks.tool_call({ toolName: 'bash', input: { command: 'mkdir artifacts' } }, f.ctx).block, true);
  assert.equal(f.hooks.tool_call({ toolName: 'bash', input: { command: 'ls -la' } }, f.ctx), undefined);
  await f.call('delivery_plan', f.plan);
  assert.equal(f.hooks.tool_call({ toolName: 'write' }), undefined);
  const finish = { status: 'verified', review: 'Reviewed executable behavior.', launch: 'python app.py', limitations: [] };
  await assert.rejects(f.call('delivery_finish', finish), /Cannot verify/);
  await f.call('delivery_check', { id: 'all' });
  await f.call('delivery_finish', finish);
  assert.equal(f.entries.at(-1).data.status, 'verified');
  // Undeclared file changes must invalidate evidence, not only artifact roots.
  writeFileSync(join(f.cwd, 'new_config.json'), '{}');
  await assert.rejects(f.call('delivery_finish', finish), /stale checks/);
});
test('delivery_finish re-entry guard prevents the agent from looping on a finished delivery', options, async t => {
  const f = fixture(t);
  const finish = { status: 'verified', review: 'Reviewed.', launch: 'python app.py', limitations: [] };
  await f.call('delivery_plan', f.plan);
  await f.call('delivery_check', { id: 'all' });
  await f.call('delivery_finish', finish);
  // Immediate re-call with no file changes — must return "already finished",
  // not re-process and return a fresh success (which gives no stop signal).
  const second = await f.call('delivery_finish', finish);
  assert.match(second.content[0].text, /already finished/i);
  assert.match(second.content[0].text, /do not call delivery_finish again/i);
  // After a real file change the guard falls through to normal validation.
  writeFileSync(join(f.cwd, 'new_file.py'), 'x = 1');
  await assert.rejects(f.call('delivery_finish', finish), /stale checks/);
});
test('context handler stops re-injecting the delivery contract after verified status', options, async t => {
  const f = fixture(t);
  await f.call('delivery_plan', f.plan);
  await f.call('delivery_check', { id: 'all' });
  await f.call('delivery_finish', { status: 'verified', review: 'ok', launch: 'python app.py', limitations: [] });
  f.hooks.session_start({}, f.ctx);
  // After verified, the context handler must not tell the agent to "proceed
  // to delivery_finish" — that instruction causes the agent to re-call
  // delivery_finish and loop.
  const result = f.hooks.context({ messages: [] });
  assert.equal(result, undefined);
});
test('real extension serializes sibling checks without tool errors', options, async t => {
  const f = fixture(t);
  f.plan.checks.push({ ...f.plan.checks[0], id: 'second' });
  await f.call('delivery_plan', f.plan);
  await Promise.all([f.call('delivery_check', { id: 'run' }), f.call('delivery_check', { id: 'second' })]);
  assert.ok(f.entries.at(-1).data.evidence.run.passed);
  assert.ok(f.entries.at(-1).data.evidence.second.passed);
});
test('compaction context survives restore, branching clears stale contracts', options, async t => {
  const f = fixture(t);
  await f.call('delivery_plan', f.plan);
  f.hooks.session_start({}, f.ctx);
  const context = f.hooks.context({ messages: [] });
  assert.match(context.messages[0].content, /Working script/);
  f.entries.length = 0;
  f.hooks.session_tree({}, f.ctx);
  assert.match((await f.call('delivery_status')).content[0].text, /No delivery contract/);
});
test('compaction context does not direct re-checks when all evidence is fresh', options, async t => {
  const f = fixture(t);
  await f.call('delivery_plan', f.plan);
  await f.call('delivery_check', { id: 'all' });
  // session_start → restore reloads state and stores cwd for the context handler.
  f.hooks.session_start({}, f.ctx);
  const context = f.hooks.context({ messages: [] });
  assert.doesNotMatch(context.messages[0].content, /delivery_check id="all"/);
  assert.match(context.messages[0].content, /current passing evidence/i);
});
test('agent_end queues at most two repairs and does not revive cancelled work', options, async t => {
  const f = fixture(t);
  await f.call('delivery_plan', f.plan);
  const event = reason => ({ messages: [{ role: 'assistant', stopReason: reason }] });
  f.hooks.agent_end(event('aborted'), f.ctx);
  assert.equal(f.messages.length, 0);
  f.hooks.agent_end(event('stop'), f.ctx);
  f.hooks.agent_end(event('stop'), f.ctx);
  f.hooks.agent_end(event('stop'), f.ctx);
  assert.equal(f.messages.length, 2);
  await f.call('delivery_finish', { status: 'blocked', review: 'Environment unavailable', launch: 'python app.py', limitations: ['No renderer available'] });
  f.hooks.input({ source: 'interactive' });
  f.hooks.agent_end(event('stop'), f.ctx);
  assert.equal(f.messages.length, 2);
});
test('repair nudges quote the failing check, its exit code and its output tail', options, async t => {
  const f = fixture(t);
  f.plan.checks[0].argv = [process.execPath, '-e', 'console.log("probe detail: only 2 sampled colors"); process.exit(9)'];
  await f.call('delivery_plan', f.plan);
  await assert.rejects(f.call('delivery_check', { id: 'run' }), /"code": 9/);
  // The failing check's evidence carries a persisted output tail for status/compaction.
  const state = f.entries.at(-1).data;
  assert.equal(state.evidence.run.passed, false);
  assert.match(state.evidence.run.outputTail, /probe detail: only 2 sampled colors/);
  f.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, f.ctx);
  assert.equal(f.messages.length, 1);
  const content = f.messages[0].content;
  assert.match(content, /check run failed \(exit 9, timedOut false\)/);
  assert.match(content, /probe detail: only 2 sampled colors/);
  assert.match(content, /pending checks: run/);
  // Compaction context keeps only a short tail, not the full 1200-character evidence copy.
  const context = f.hooks.context({ messages: [] });
  assert.match(context.messages[0].content, /"passed":false/);
  assert.match(context.messages[0].content, /delivery_check id="all"/);
  assert.ok(context.messages[0].content.length < 4000);
});

test('delivery-gate follow-up does not reset the nudge cap (no infinite loop)', options, async t => {
  const f = fixture(t);
  f.plan.checks[0].argv = [process.execPath, '-e', 'process.exit(1)'];
  await f.call('delivery_plan', f.plan);
  await assert.rejects(f.call('delivery_check', { id: 'run' }));
  // Nudge 1 — shouldContinue fires, nudges becomes 1.
  f.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, f.ctx);
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].content, /Delivery follow-up 1\/2/);
  // The follow-up re-enters as input — this must NOT reset nudges.
  f.hooks.input({ source: 'interactive', text: f.messages[0].content });
  // Nudge 2 — nudges becomes 2.
  f.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, f.ctx);
  assert.equal(f.messages.length, 2);
  assert.match(f.messages[1].content, /Delivery follow-up 2\/2/);
  // The follow-up re-enters again — still must NOT reset.
  f.hooks.input({ source: 'interactive', text: f.messages[1].content });
  // Nudge 3 — shouldContinue returns false (2 < 2 is false), no more nudges.
  f.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, f.ctx);
  assert.equal(f.messages.length, 2, 'nudge cap held — no third nudge');
  // A genuine user prompt resets the cap.
  f.hooks.input({ source: 'interactive', text: 'fix the failing check' });
  f.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, f.ctx);
  assert.equal(f.messages.length, 3);
  assert.match(f.messages[2].content, /Delivery follow-up 1\/2/);
});
test('bash timeout cap bounds runaway shell commands when configured', options, t => {
  const f = fixture(t);
  // Disabled by default: un-timed commands stay un-timed.
  const runaway = { toolName: 'bash', input: { command: 'find / -name verify_ursina.py' } };
  f.hooks.tool_call(runaway);
  assert.equal(runaway.input.timeout, undefined);
  // Enabled: caps missing and oversized timeouts, preserves tighter explicit ones.
  f.flags['delivery-bash-cap'] = 120;
  f.hooks.tool_call(runaway);
  assert.equal(runaway.input.timeout, 120);
  const tight = { toolName: 'bash', input: { command: 'ls', timeout: 10 } };
  f.hooks.tool_call(tight);
  assert.equal(tight.input.timeout, 10);
  const over = { toolName: 'powershell', input: { command: 'x', timeout: 9999 } };
  f.hooks.tool_call(over);
  assert.equal(over.input.timeout, 120);
  // Non-shell tools and blocked-write gating are untouched.
  const read = { toolName: 'read', input: { path: 'app.py' } };
  f.hooks.tool_call(read);
  assert.equal(read.input.timeout, undefined);
  assert.equal(f.hooks.tool_call({ toolName: 'write' }).block, true);
});
test('edit calls normalize a JSON-encoded edits array', options, async t => {
  const f = fixture(t);
  await f.call('delivery_plan', f.plan);
  const event = {
    toolName: 'edit',
    input: {
      path: 'app.py',
      edits: JSON.stringify([{ oldText: 'print(1)', newText: 'print(2)' }]),
    },
  };
  assert.equal(f.hooks.tool_call(event, f.ctx), undefined);
  assert.deepEqual(event.input.edits, [{ oldText: 'print(1)', newText: 'print(2)' }]);
});
test('bash cap blocks process-wide termination but allows targeted child cleanup', options, t => {
  const f = fixture(t);
  f.flags['delivery-bash-cap'] = 120;
  for (const command of [
    'pkill -f python',
    'killall node',
    'kill -9 -1',
    'kill 0',
    'taskkill /IM python.exe /F',
    'Stop-Process -Name python',
    'Get-Process | Stop-Process',
  ]) {
    const broadKill = { toolName: 'bash', input: { command } };
    assert.match(
      f.hooks.tool_call(broadKill).reason,
      /Broad process termination/
    );
  }

  const targetedKill = {
    toolName: 'bash',
    input: { command: 'kill "$child_pid"' }
  };
  assert.equal(f.hooks.tool_call(targetedKill), undefined);
  assert.equal(targetedKill.input.timeout, 120);
});
test('bounded runs cap whole-file rewrites per path and pace tool loops', options, async t => {
  const f = fixture(t);
  f.flags['delivery-strict'] = false;
  f.flags['delivery-rewrite-cap'] = 2;
  const write = path => f.hooks.tool_call({ toolName: 'write', input: { path } }, f.ctx);
  f.flags['delivery-protect-existing'] = true;
  f.hooks.session_start({}, f.ctx);
  assert.match(write('app.py').reason, /Preserve the existing app.py implementation/);
  assert.equal(f.hooks.tool_call({ toolName: 'edit', input: { path: 'app.py' } }, f.ctx), undefined);
  assert.match(
    f.hooks.tool_call(
      { toolName: 'bash', input: { command: `cat > "${join(f.cwd, 'app.py')}" <<'EOF'\nprint(2)\nEOF` } },
      f.ctx,
    ).reason,
    /Shell redirection cannot replace/,
  );
  assert.match(
    f.hooks.tool_call(
      { toolName: 'bash', input: { command: "python - <<'PY'\nwith open('app.py', 'w') as f:\n f.write('print(2)')\nPY" } },
      f.ctx,
    ).reason,
    /script cannot replace/,
  );
  assert.match(
    f.hooks.tool_call(
      { toolName: 'bash', input: { command: `mv /tmp/replacement.py "${join(f.cwd, 'app.py')}"` } },
      f.ctx,
    ).reason,
    /cannot remove or replace/,
  );
  f.flags['delivery-protect-existing'] = false;
  f.hooks.session_start({}, f.ctx);
  assert.equal(write('app.py'), undefined);
  assert.equal(write('app.py'), undefined);
  assert.match(write('app.py').reason, /Full-file rewrite limit reached/);
  assert.equal(write('README.md'), undefined);
  assert.equal(f.hooks.tool_call({ toolName: 'edit', input: { path: 'app.py' } }), undefined);
  assert.match(
    f.hooks.tool_call(
      { toolName: 'write', input: { path: f.cwd.replace(/^\/+/, '') + '/nested.py' } },
      f.ctx,
    ).reason,
    /recreates the working directory/,
  );
  assert.match(
    f.hooks.tool_call(
      { toolName: 'write', input: { path: `${f.cwd.split('/').at(-1)}/nested.py` } },
      f.ctx,
    ).reason,
    /recreates the working directory/,
  );

  f.flags['delivery-turn-delay-ms'] = 20;
  const started = Date.now();
  await f.hooks.tool_result({ toolName: 'read', isError: false });
  assert.ok(Date.now() - started >= 15);

  f.flags['delivery-turn-delay-ms'] = 10;
  const scaled = Date.now();
  await f.hooks.tool_result(
    { toolName: 'read', isError: false },
    { getContextUsage: () => ({ tokens: 100001 }) },
  );
  assert.ok(Date.now() - scaled >= 25);

  f.flags['delivery-turn-delay-ms'] = 0;
  f.flags['delivery-tool-output-cap'] = 100;
  const bounded = await f.hooks.tool_result({
    toolName: 'bash',
    isError: false,
    content: [{ type: 'text', text: `${'head'.repeat(30)}${'tail'.repeat(30)}` }],
  });
  assert.equal(bounded.content[0].text.length, 100);
  assert.match(bounded.content[0].text, /characters omitted/);
  assert.match(bounded.content[0].text, /^head/);
  assert.match(bounded.content[0].text, /tail$/);
});
test('optional delivery context is explicit and task agnostic', options, t => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, 'quality-context.md'), 'Require evidence from the public user path.');
  f.flags['delivery-context'] = 'quality-context.md';
  f.hooks.session_start({}, f.ctx);
  const context = f.hooks.before_agent_start({ systemPrompt: 'base', prompt: 'Build a voxel game' });
  assert.match(context.systemPrompt, /Require evidence from the public user path/);
  assert.doesNotMatch(context.systemPrompt, /camera.ui_lens.set_film_size/);
  assert.match(context.systemPrompt, /Scope honestly: enumerate every explicit requirement/);
});
test('required validators cannot be omitted or replaced by model plans', options, async t => {
  const f = fixture(t);
  const manifest = join(f.cwd, 'validators.json');
  writeFileSync(manifest, JSON.stringify({ version: 1, checks: [{ id: 'oracle', kind: 'test', argv: [process.execPath, '-e', 'process.exit(9)'], timeoutSeconds: 5 }] }));
  f.flags['delivery-validators'] = manifest;
  f.hooks.session_start({}, f.ctx);
  await f.call('delivery_plan', f.plan);
  const state = f.entries.at(-1).data;
  assert.ok(state.plan.checks.some(c => c.id === 'required_oracle'));
  await f.call('delivery_check', { id: 'run' });
  await assert.rejects(f.call('delivery_finish', { status: 'verified', review: 'All good', launch: 'python app.py', limitations: [] }), /required_oracle/);
  await assert.rejects(f.call('delivery_check', { id: 'all' }), /"code": 9/);
  f.plan.checks.push({ id: 'required_oracle', kind: 'runtime', argv: [process.execPath, '-e', 'process.exit(0)'], timeoutSeconds: 5 });
  await f.call('delivery_plan', f.plan);
  assert.match(f.entries.at(-1).data.plan.checks.find(c => c.id === 'required_oracle').argv[2], /exit\(9\)/);
});
test('invalid required manifest fails closed', options, async t => {
  const f = fixture(t);
  f.flags['delivery-validators'] = join(f.cwd, 'missing.json');
  f.hooks.session_start({}, f.ctx);
  await assert.rejects(f.call('delivery_plan', f.plan), /Invalid required validators/);
});
test('source mutation by a verifier is recorded as failed evidence', options, async t => {
  const f = fixture(t);
  f.plan.checks[0].argv = [process.execPath, '-e', 'require("node:fs").writeFileSync("app.py", "changed")'];
  await f.call('delivery_plan', f.plan);
  await assert.rejects(f.call('delivery_check', { id: 'run' }), /changedDuringCheck/);
  assert.equal(f.entries.at(-1).data.evidence.run.passed, false);
});
test('request guidance is injected behind the scenes and survives follow-ups', options, async t => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, 'package.json'), JSON.stringify({ dependencies: { next: '15.1.7' } }));
  const prompt = 'Add authenticated trades and a portfolio time series chart backed by a third-party API';
  const started = f.hooks.before_agent_start({ systemPrompt: 'base', prompt }, f.ctx);
  for (const id of ['web-application', 'authenticated-web', 'transactional-data', 'external-api', 'data-visualization']) assert.match(started.systemPrompt, new RegExp(`\\[${id}\\]`));
  await f.call('delivery_plan', f.plan);
  const state = f.entries.at(-1).data;
  // Persisted only for internal continuity across resumes and follow-up prompts.
  assert.deepEqual(state.guidanceProfiles, ['web-application', 'authenticated-web', 'transactional-data', 'external-api', 'data-visualization']);
  assert.equal(state.plan.guidanceProfiles, undefined);
  assert.doesNotMatch(readFileSync(join(f.cwd, '.harness', 'integration-session', state.runId, 'plan.d2'), 'utf8'), /guidance/i);
  const followUp = f.hooks.before_agent_start({ systemPrompt: 'base', prompt: 'Fix that failure' }, f.ctx);
  assert.match(followUp.systemPrompt, /\[transactional-data\]/);
  assert.match(followUp.systemPrompt, /\[data-visualization\]/);
});

const finish = { status: 'verified', review: 'Reviewed executable behavior.', launch: 'python app.py', limitations: [] };
async function verifyRun(f) {
  await f.call('delivery_plan', f.plan);
  await f.call('delivery_check', { id: 'all' });
  await f.call('delivery_finish', finish);
}
const reviewMessages = f => f.messages.filter(m => m.customType === 'delivery-review');

test('review mode yes auto-kicks the loop after a verified finish', options, async t => {
  const f = fixture(t);
  f.flags['delivery-review'] = 'yes';
  await verifyRun(f);
  f.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, f.ctx);
  assert.equal(reviewMessages(f).length, 1);
  assert.match(reviewMessages(f)[0].content, /gh pr create/);
  assert.match(reviewMessages(f)[0].content, /pi2\.mjs" review <pr-number-or-url>/);
  // The loop is active — subsequent run ends must not re-kick.
  f.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, f.ctx);
  assert.equal(reviewMessages(f).length, 1);
});

test('review mode no never offers or kicks the loop', options, async t => {
  const f = fixture(t);
  f.flags['delivery-review'] = 'no';
  await verifyRun(f);
  f.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, f.ctx);
  assert.equal(reviewMessages(f).length, 0);
  assert.doesNotMatch(f.hooks.before_agent_start({ systemPrompt: 'base', prompt: 'more work' }, f.ctx).systemPrompt, /Self-review/);
});

test('review mode ask defers to the host over rpc and hints when headless', options, async t => {
  const f = fixture(t);
  await verifyRun(f);
  // rpc host (pi2 console) renders the offer itself — extension stays silent.
  f.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, f.ctx);
  assert.equal(reviewMessages(f).length, 0);
  // Headless mode gets a passive, non-turn hint instead.
  const headless = fixture(t);
  headless.ctx.mode = 'print';
  await verifyRun(headless);
  headless.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, headless.ctx);
  assert.equal(reviewMessages(headless).length, 1);
  assert.match(reviewMessages(headless)[0].content, /run \/review/i);
});

test('review mode ask prompts via ui.select on a real pi TUI', options, async t => {
  const f = fixture(t);
  f.ctx.mode = 'tui';
  let asked = 0;
  f.ctx.ui.select = async () => { asked++; return 'Start self-review'; };
  await verifyRun(f);
  f.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, f.ctx);
  await new Promise(r => setImmediate(r));
  assert.equal(asked, 1);
  assert.equal(reviewMessages(f).length, 1);
  // A declined offer is not repeated for the same fingerprint.
  const declined = fixture(t);
  declined.ctx.mode = 'tui';
  let askedTwice = 0;
  declined.ctx.ui.select = async () => { askedTwice++; return 'Skip'; };
  await verifyRun(declined);
  declined.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, declined.ctx);
  declined.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, declined.ctx);
  await new Promise(r => setImmediate(r));
  assert.equal(askedTwice, 1);
  assert.equal(reviewMessages(declined).length, 0);
});

test('/review command starts a loop and persists mode defaults', options, async t => {
  const f = fixture(t);
  assert.ok(f.commands.review, 'extension registers a /review command');
  await f.commands.review.handler('', f.ctx);
  assert.equal(reviewMessages(f).length, 1);
  // Persisting 'no' is honored immediately — a verified finish stays silent.
  const f2 = fixture(t);
  await f2.commands.review.handler('no', f2.ctx);
  await verifyRun(f2);
  f2.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, f2.ctx);
  assert.equal(reviewMessages(f2).length, 0);
  // An explicit flag still wins over the persisted default for the session.
  f2.flags['delivery-review'] = 'yes';
  f2.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, f2.ctx);
  assert.equal(reviewMessages(f2).length, 1);
});

test('review guidance is described when the loop is opt-in or automatic', options, async t => {
  const f = fixture(t);
  const asked = f.hooks.before_agent_start({ systemPrompt: 'base', prompt: 'task' }, f.ctx);
  assert.match(asked.systemPrompt, /Self-review is available and opt-in/);
  f.flags['delivery-review'] = 'yes';
  const auto = f.hooks.before_agent_start({ systemPrompt: 'base', prompt: 'task' }, f.ctx);
  assert.match(auto.systemPrompt, /Self-review runs automatically/);
});

test('self-review round cap blocks reviewer runs past the limit', options, async t => {
  const f = fixture(t);
  const reviewBash = cmd => f.hooks.tool_call({ toolName: 'bash', input: { command: cmd } }, f.ctx);
  // Outside a loop, reviewer invocations are never capped.
  assert.equal(reviewBash('node "/x/bin/pi2.mjs" review 15'), undefined);
  await f.commands.review.handler('', f.ctx); // start a loop
  // Mode changes and status checks are not rounds.
  assert.equal(reviewBash('pi2 review yes'), undefined);
  assert.equal(reviewBash('pi2 review status'), undefined);
  assert.equal(reviewBash('pi2 review'), undefined);
  // Rounds 1..3 run; round 4 is blocked with a wrap-up instruction.
  for (const cmd of ['pi2 review 15', 'node "/x/bin/pi2.mjs" review 15 --timeout 60', 'pi2 review https://github.com/o/r/pull/15']) {
    assert.equal(reviewBash(cmd), undefined, cmd);
  }
  const blocked = reviewBash('pi2 review 15');
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /round limit \(3\)/);
  // User input resets the loop (and the counter) — a fresh loop may start.
  f.hooks.input({ source: 'user' });
  await f.commands.review.handler('', f.ctx);
  assert.equal(reviewBash('pi2 review 15'), undefined);
});

test('delivery_plan accepts an outputs list and requires it at verified finish', options, async t => {
  const f = fixture(t);
  await f.call('delivery_plan', { ...f.plan, outputs: ['artifacts/proof.txt'] });
  await f.call('delivery_check', { id: 'all' });
  const finish = { status: 'verified', review: 'ok', launch: 'python app.py', limitations: [] };
  // The declared output does not exist yet — verified must be refused.
  await assert.rejects(f.call('delivery_finish', finish), /Missing artifacts\/outputs.*proof\.txt/);
  // Producing it under the ignored artifacts/ dir must not invalidate evidence.
  mkdirSync(join(f.cwd, 'artifacts'), { recursive: true });
  writeFileSync(join(f.cwd, 'artifacts', 'proof.txt'), 'render sampled 3 colors');
  await f.call('delivery_finish', finish);
  assert.equal(f.entries.at(-1).data.status, 'verified');
  assert.deepEqual(f.entries.at(-1).data.plan.outputs, ['artifacts/proof.txt']);
});

test('delivery_revise preserves unchanged evidence, drops changed evidence and keeps step status', options, async t => {
  const f = fixture(t);
  f.plan.steps = ['Implement', 'Verify', 'Ship'];
  f.plan.checks.push({ ...f.plan.checks[0], id: 'second' });
  f.plan.acceptance = [{ requirement: 'Runs', checks: ['run', 'second'] }];
  await f.call('delivery_plan', f.plan);
  await f.call('delivery_progress', { step: 0, status: 'done' });
  await f.call('delivery_check', { id: 'all' });
  assert.equal(f.entries.at(-1).data.evidence.run.passed, true);

  // Change only the second check; keep run byte-identical.
  const result = await f.call('delivery_revise', {
    steps: ['Implement', 'Verify', 'Ship', 'Document'],
    checks: [
      { id: 'run', kind: 'runtime', argv: [process.execPath, '-e', 'console.log("passed")'], timeoutSeconds: 5 },
      { id: 'second', kind: 'runtime', argv: [process.execPath, '-e', 'console.log("changed")'], timeoutSeconds: 5 },
    ],
  });
  const state = f.entries.at(-1).data;
  assert.equal(state.plan.steps.length, 4);
  assert.ok(state.evidence.run, 'unchanged check keeps evidence');
  assert.equal(state.evidence.second, undefined, 'changed check drops evidence');
  assert.equal(state.stepStatus.step0, 'done', 'unchanged step keeps status');
  assert.equal(state.status, 'implementing');
  assert.match(result.content[0].text, /evidencePreserved/);
  // The revised contract now has a pending check, so verified is refused.
  await assert.rejects(f.call('delivery_finish', { status: 'verified', review: 'ok', launch: 'x', limitations: [] }), /second/);

  // Changing a step's text resets its status; other steps keep theirs.
  await f.call('delivery_revise', { steps: ['Implement properly', 'Verify', 'Ship', 'Document'] });
  const after = f.entries.at(-1).data;
  assert.equal(after.stepStatus.step0, undefined, 'renamed step loses status');
});

test('delivery_revise cannot silently drop an original acceptance requirement', options, async t => {
  const f = fixture(t);
  await f.call('delivery_plan', f.plan);
  await assert.rejects(
    f.call('delivery_revise', { acceptance: [{ requirement: 'Something else', checks: ['run'] }] }),
    /cannot silently remove acceptance criteria/i,
  );
});
