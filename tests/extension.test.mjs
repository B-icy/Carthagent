import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Load the project extension even without a global engine installation.
const requirePi = createRequire(import.meta.url);
const { createJiti } = requirePi('jiti');
const jiti = createJiti(import.meta.url, { alias: { typebox: requirePi.resolve('typebox'), '@earendil-works/pi-coding-agent': fileURLToPath(new URL('../vendor/agent/index.js', import.meta.url)) } });
const factory = await jiti.import(fileURLToPath(new URL('../extensions/delivery.ts', import.meta.url)), { default: true });
const options = {};
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'pi extension integration '));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, 'app.py'), 'print(1)');
  const hooks = {}, commands = {}, tools = {}, entries = [], messages = [], flags = { 'delivery-strict': true };
  const pi = {
    registerCommand(name, command) { commands[name] = command; },
    registerFlag() {}, getFlag: name => flags[name],
    on(name, fn) { hooks[name] = fn; },
    registerTool(tool) { tools[tool.name] = tool; },
    appendEntry(customType, data) { entries.push({ type: 'custom', customType, data }); },
    sendMessage(message) { messages.push(message); },
  };
  factory(pi);
  const ctx = { cwd, hasUI: false, aborted: 0, abort() { this.aborted++; }, sessionManager: { getEntries: () => entries, getBranch: () => entries, getSessionId: () => 'integration-session' }, hasPendingMessages: () => false };
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
test('terminal deliveries stop context reminders and repair turns across restore', options, async t => {
  for (const status of ['verified', 'blocked']) {
    const f = fixture(t);
    await f.call('delivery_plan', f.plan);
    assert.match(f.hooks.context({ messages: [] }).messages[0].content, /inspect current freshness/);
    await f.call('delivery_check', { id: 'all' });
    await f.call('delivery_finish', { status, review: 'Reviewed', launch: 'python app.py', limitations: status === 'blocked' ? ['External prerequisite unavailable'] : [] });
    for (const restore of [false, true]) {
      if (restore) f.hooks.session_start({}, f.ctx);
      assert.equal(f.hooks.context({ messages: [] }), undefined);
      f.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, f.ctx);
      assert.equal(f.messages.length, 0);
    }
    await f.call('delivery_plan', f.plan);
    assert.match(f.hooks.context({ messages: [] }).messages[0].content, /inspect current freshness/);
  }
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
  assert.ok(context.messages[0].content.length < 4000);
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

test('blocked delivery succeeds and finishes cleanly even when evidence scope limit is exceeded', options, async t => {
  const f = fixture(t);
  const oldEnv = process.env.PI2_MAX_FILES;
  t.after(() => {
    if (oldEnv === undefined) delete process.env.PI2_MAX_FILES;
    else process.env.PI2_MAX_FILES = oldEnv;
  });

  // Create plan
  await f.call('delivery_plan', f.plan);

  // Set tight file limit (1 file) and add a second file
  process.env.PI2_MAX_FILES = '1';
  writeFileSync(join(f.cwd, 'extra.txt'), 'extra');

  // delivery_status tolerates scope limit
  const status = await f.call('delivery_status');
  assert.match(status.content[0].text, /scope error/);

  // delivery_check reports scope error with guidance
  await assert.rejects(
    f.call('delivery_check', { id: 'run' }),
    /Evidence scope error.*status="blocked"/
  );

  // delivery_finish with status='verified' must still fail
  await assert.rejects(
    f.call('delivery_finish', {
      status: 'verified',
      review: 'Trying to verify despite scope limits',
      launch: 'python app.py',
      limitations: [],
    }),
    /Evidence scope exceeds/
  );

  // delivery_finish with status='blocked' must SUCCEED without looping or throwing
  const finishBlocked = await f.call('delivery_finish', {
    status: 'blocked',
    review: 'Repository exceeds evidence scope limit; cannot run fingerprint',
    launch: 'python app.py',
    limitations: ['Repository exceeds maximum file count limit for automated checks.'],
  });
  assert.equal(finishBlocked.content[0].type, 'text');
  const lastEntry = f.entries.at(-1).data;
  assert.equal(lastEntry.status, 'blocked');
  assert.equal(lastEntry.handoff.fingerprint, 'unfingerprinted:scope_exceeded');

  // agent_end should NOT trigger follow-up nudges since status is blocked
  f.messages.length = 0;
  f.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, f.ctx);
  assert.equal(f.messages.length, 0);
});

test('informational receipts get a classification hint, build tasks do not', options, t => {
  const f = fixture(t);
  const question = f.hooks.before_agent_start({ systemPrompt: 'base', prompt: 'what does app.py do?' }, f.ctx);
  assert.match(question.systemPrompt, /Receipt check/);
  assert.match(question.systemPrompt, /verification:"none"/);
  const build = f.hooks.before_agent_start({ systemPrompt: 'base', prompt: 'build a task cli with tests' }, f.ctx);
  assert.doesNotMatch(build.systemPrompt, /Receipt check/);
});

test('verification:none plan finishes cleanly with no checks and no repair nudges', options, async t => {
  const f = fixture(t);
  await f.call('delivery_plan', { ...f.plan, verification: 'none', checks: [], acceptance: [] });
  assert.equal(f.entries.at(-1).data.plan.verification, 'none');
  // delivery_check explains the route to finish instead of erroring into a loop.
  const noChecks = await f.call('delivery_check', { id: 'all' });
  assert.match(noChecks.content[0].text, /no checks to run/);
  const finish = { status: 'verified', review: 'Answered the question from source.', launch: 'n/a', limitations: [] };
  await f.call('delivery_finish', finish);
  const handoff = f.entries.at(-1).data.handoff;
  assert.equal(handoff.status, 'verified');
  assert.equal(handoff.verification, 'none');
  assert.equal(handoff.advisory, true);
  // Unlike a required verified run with a stale fingerprint, informative plans are terminal.
  f.messages.length = 0;
  f.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, f.ctx);
  assert.equal(f.messages.length, 0);
});

test('advisory checks record real failures without throwing or blocking finish', options, async t => {
  const f = fixture(t);
  const failing = { ...f.plan, verification: 'advisory' };
  failing.checks = [{ ...f.plan.checks[0], argv: [process.execPath, '-e', 'console.log("advisory context"); process.exit(4)'] }];
  await f.call('delivery_plan', failing);
  const result = await f.call('delivery_check', { id: 'all' });
  assert.match(result.content[0].text, /advisory context/);
  const evidence = f.entries.at(-1).data.evidence.run;
  assert.equal(evidence.passed, false);
  assert.equal(evidence.code, 4);
  // A failing advisory check is context, not a repair order.
  await f.call('delivery_finish', { status: 'verified', review: 'Reported the measured failure as context.', launch: 'n/a', limitations: ['advisory check failed by design'] });
  const handoff = f.entries.at(-1).data.handoff;
  assert.equal(handoff.advisory, true);
  assert.equal(handoff.verification, 'advisory');
  f.messages.length = 0;
  f.hooks.agent_end({ messages: [{ role: 'assistant', stopReason: 'stop' }] }, f.ctx);
  assert.equal(f.messages.length, 0);
});

test('pre-verify reclassification is refused once evidence exists', options, async t => {
  const f = fixture(t);
  await f.call('delivery_plan', f.plan);
  // No evidence yet: the pre-verify re-check may downgrade to informational.
  await f.call('delivery_plan', { ...f.plan, verification: 'none', checks: [], acceptance: [] });
  assert.equal(f.entries.at(-1).data.plan.verification, 'none');
  await f.call('delivery_plan', f.plan);
  await f.call('delivery_check', { id: 'run' });
  await assert.rejects(
    f.call('delivery_plan', { ...f.plan, verification: 'none', checks: [], acceptance: [] }),
    /Cannot downgrade verification after checks have run/,
  );
});

test('required validators force verification:required on an informational plan', options, async t => {
  const f = fixture(t);
  const manifest = join(f.cwd, 'validators.json');
  writeFileSync(manifest, JSON.stringify({ version: 1, checks: [{ id: 'oracle', kind: 'test', argv: [process.execPath, '-e', 'process.exit(0)'], timeoutSeconds: 5 }] }));
  f.flags['delivery-validators'] = manifest;
  f.hooks.session_start({}, f.ctx);
  await f.call('delivery_plan', { ...f.plan, verification: 'none', checks: [], acceptance: [] });
  const state = f.entries.at(-1).data;
  assert.equal(state.plan.verification, 'required');
  assert.ok(state.plan.checks.some(c => c.id === 'required_oracle'));
});


test('session budget survives replan, input and branch restoration; only command resets', options, async t => {
  const f = fixture(t);
  f.flags['delivery-max-tools'] = '2';
  f.hooks.agent_start({}, f.ctx);
  await f.call('delivery_plan', f.plan);
  assert.equal(f.hooks.tool_call({ toolName: 'delivery_status' }, f.ctx), undefined);
  await f.call('delivery_plan', f.plan);
  f.hooks.input({ source: 'user' });
  f.hooks.session_tree({}, f.ctx);
  assert.equal(f.hooks.tool_call({ toolName: 'delivery_status' }, f.ctx), undefined);
  assert.equal(f.hooks.tool_call({ toolName: 'read' }, f.ctx).block, true);
  f.hooks.agent_end({ messages: [] }, f.ctx);
  assert.equal(f.messages.length, 1);
  const stop = JSON.parse(f.messages[0].content);
  assert.equal(stop.reason, 'tool-calls');
  assert.deepEqual(stop.requirements, f.plan.acceptance);
  assert.ok(f.ctx.aborted > 0);
  f.commands['delivery-budget-reset'].handler('', f.ctx);
  assert.equal(f.hooks.tool_call({ toolName: 'read' }, f.ctx), undefined);
});

test('elapsed budget aborts an active turn without a tool and stays stopped on restore', options, async t => {
  const f = fixture(t);
  f.flags['delivery-max-seconds'] = '1';
  f.hooks.agent_start({}, f.ctx);
  await new Promise(resolve => setTimeout(resolve, 1150));
  assert.equal(f.ctx.aborted, 1);
  assert.equal(JSON.parse(f.messages[0].content).reason, 'elapsed-time');
  f.hooks.session_start({}, f.ctx);
  f.hooks.agent_start({}, f.ctx);
  assert.equal(f.messages.length, 1);
  assert.equal(f.ctx.aborted, 2);
  f.hooks.session_shutdown();
});

test('repair allowance persists across user follow-ups and stops automatic continuation', options, async t => {
  const f = fixture(t);
  f.flags['delivery-max-repairs'] = '1';
  await f.call('delivery_plan', f.plan);
  const event = { messages: [{ role: 'assistant', stopReason: 'stop' }] };
  f.hooks.agent_end(event, f.ctx);
  assert.equal(f.messages.length, 1);
  f.hooks.input({ source: 'user' });
  f.hooks.session_start({}, f.ctx);
  f.hooks.agent_end(event, f.ctx);
  assert.equal(f.messages.length, 2);
  assert.equal(JSON.parse(f.messages[1].content).reason, 'repair-rounds');
});

test('budget status command reports remaining allowance without consuming tools', options, t => {
  const f = fixture(t);
  f.flags['delivery-max-tools'] = '2';
  f.hooks.agent_start({}, f.ctx);
  f.hooks.tool_call({ toolName: 'read' }, f.ctx);
  f.commands['delivery-budget-status'].handler('', f.ctx);
  const status = JSON.parse(f.messages.at(-1).content);
  assert.equal(status.tools, 1);
  assert.equal(status.remaining.tools, 1);
  assert.equal(status.reason, null);
});
