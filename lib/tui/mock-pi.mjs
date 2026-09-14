#!/usr/bin/env node
/**
 * Mock `pi --mode rpc` for `pi2 demo`: speaks the rpc line protocol and plays a
 * scripted end-to-end delivery (plan → build → check → finish) so the console's
 * visuals can be exercised without a provider or API credit.
 *
 * It also writes real .harness/<session>/<run>/report.json + plan.d2 files, so
 * the side panel exercises the same file-watching path as a live run.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { planD2, fingerprint } from '../delivery.mjs';

const SPEED = Math.max(0.05, Number(process.env.PI2_DEMO_SPEED) || 1);
const sleep = ms => new Promise(r => setTimeout(r, ms * SPEED));
const emit = obj => process.stdout.write(JSON.stringify(obj) + '\n');

const SESSION_ID = 'demo';
const cwd = process.cwd();
const runId = randomUUID();
const harnessDir = join(cwd, '.harness', SESSION_ID, runId);

const stats = { tokens: 0, cost: 0, toolCalls: 0, userMessages: 0, streaming: false, compacting: false, ctx: 9000 };
let aborted = false;
let pendingPrompt = null;

const usage = (input, output) => {
  const totalTokens = input + output;
  stats.tokens += totalTokens;
  stats.cost += totalTokens * 1.2e-6;
  stats.ctx = Math.min(190000, stats.ctx + Math.round(totalTokens * 0.8));
  return { totalTokens, input, output, cost: { total: totalTokens * 1.2e-6 } };
};

function taskSummary(prompt) {
  // The console wraps tasks in the delivery template; recover the user's text.
  const m = String(prompt).match(/^Deliver this task in phases(?: with executable evidence)?:\s*([\s\S]*?)\n\n/);
  const clean = (m ? m[1] : String(prompt)).replace(/\s+/g, ' ').trim();
  return clean.length > 64 ? clean.slice(0, 63) + '…' : clean || 'demo task';
}

function demoPlan(prompt) {
  return {
    goal: taskSummary(prompt),
    assumptions: ['standard library only', 'tests run in a fresh subprocess'],
    artifacts: ['.'],
    steps: ['Inspect workspace and probe runtime', 'Implement runnable vertical slice', 'Cover edge cases, tests and docs'],
    acceptance: [
      { requirement: 'Core behavior works in a fresh process', checks: ['smoke'] },
      { requirement: 'Edge cases and persistence covered by tests', checks: ['unit'] },
    ],
    checks: [
      { id: 'unit', kind: 'test', argv: ['node', '--test', 'tests/app.test.mjs'], timeoutSeconds: 60 },
      { id: 'smoke', kind: 'runtime', argv: ['node', 'app.mjs', '--smoke'], timeoutSeconds: 30 },
    ],
  };
}

function writeReport(state) {
  mkdirSync(harnessDir, { recursive: true });
  writeFileSync(join(harnessDir, 'report.json'), JSON.stringify(state, null, 2) + '\n');
  writeFileSync(join(harnessDir, 'plan.d2'), planD2(state.plan));
}

async function toolCall(id, name, args, result, { update, ms = 600 } = {}) {
  emit({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, id, toolName: name } });
  stats.toolCalls++;
  emit({ type: 'tool_execution_start', toolCallId: id, toolName: name, args });
  if (update) for (const u of update) { await sleep(320); emit({ type: 'tool_execution_update', toolCallId: id, partialResult: { content: [{ type: 'text', text: u }] } }); }
  await sleep(ms);
  emit({ type: 'tool_execution_end', toolCallId: id, toolName: name, isError: false, result: { content: [{ type: 'text', text: result }] } });
}

async function assistantText(text, { thinking } = {}) {
  emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
  if (thinking) {
    for (const chunk of thinking.match(/.{1,24}/gs) || []) {
      emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: chunk } });
      await sleep(60);
    }
  }
  for (const chunk of text.match(/.{1,28}/gs) || []) {
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: chunk } });
    await sleep(45);
  }
  emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], usage: usage(4200, 900), stopReason: 'stop' } });
}

async function runDemo(prompt) {
  const plan = demoPlan(prompt);
  const state = { version: 1, runId, plan, evidence: {}, status: 'implementing', createdAt: new Date().toISOString() };
  stats.streaming = true; aborted = false;
  emit({ type: 'agent_start' });
  emit({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: prompt }] } });
  emit({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: prompt }] } });
  await sleep(250);

  emit({ type: 'turn_start' });
  await assistantText('I’ll inspect the workspace, define the checks, and implement the task.', {
    thinking: 'Mapping the request to a small acceptance contract.',
  });
  if (aborted) return endRun();

  await toolCall('t1', 'delivery_plan', plan, JSON.stringify({ plan: join(harnessDir, 'plan.d2'), report: join(harnessDir, 'report.json'), next: 'Build a runnable slice, add regression tests, then delivery_check each check ID.' }, null, 2));
  writeReport(state);
  await sleep(300);

  emit({ type: 'turn_start' });
  await toolCall('t2', 'ls', { path: '.' }, 'app.mjs\ntests/\nREADME.md', { ms: 350 });
  await toolCall('t3', 'write', { path: 'app.mjs', content: '// demo' }, 'Wrote app.mjs (86 lines)', { ms: 500 });
  if (aborted) return endRun();
  await toolCall('t4', 'write', { path: 'tests/app.test.mjs', content: '// demo' }, 'Wrote tests/app.test.mjs (41 lines)', { ms: 500 });
  await assistantText('The implementation is ready. I’m exercising the entry point before running the declared checks.', { thinking: 'Verify the runnable path end to end, not just imports.' });

  emit({ type: 'turn_start' });
  await toolCall('t5', 'bash', { command: 'node app.mjs --smoke' }, 'SMOKE ok · 3 interactions · exit 0', { ms: 700 });
  if (aborted) return endRun();

  state.status = 'verifying';
  writeReport(state);
  let fp;
  try { fp = fingerprint(cwd, ['.']); } catch { fp = 'f'.repeat(64); }
  await toolCall('t6', 'delivery_check', { id: 'all' }, JSON.stringify([
    { id: 'unit', passed: true, code: 0, durationMs: 812 },
    { id: 'smoke', passed: true, code: 0, durationMs: 1330 },
  ], null, 2), {
    update: ['Running unit: ["node","--test","tests/app.test.mjs"]', 'Running smoke: ["node","app.mjs","--smoke"]'],
    ms: 400,
  });
  for (const [id, ms] of [['unit', 812], ['smoke', 1330]]) {
    state.evidence[id] = { passed: true, fingerprint: fp, code: 0, durationMs: ms, outputTail: `${id} passed` };
  }
  writeReport(state);
  await sleep(400);

  emit({ type: 'turn_start' });
  await assistantText('The checks pass on the current fingerprint. I’m reviewing scope before finishing.');
  await toolCall('t7', 'delivery_finish', { status: 'verified', review: 'Fresh-process smoke plus unit coverage pass; scope matches the request.', launch: 'node app.mjs', limitations: ['demo evidence is scripted'] },
    JSON.stringify({ status: 'verified', report: join(harnessDir, 'report.json'), note: 'Evidence covers declared checks, not a guarantee of correctness.' }, null, 2));
  state.status = 'verified';
  state.handoff = { status: 'verified', review: 'Fresh-process smoke plus unit coverage pass.', launch: 'node app.mjs', limitations: ['demo evidence is scripted'], fingerprint: fp, at: new Date().toISOString() };
  writeReport(state);
  await assistantText('Verified. Run with `node app.mjs`.');
  endRun();
}

function endRun() {
  stats.streaming = false;
  emit({ type: 'agent_end', messages: [] });
  emit({ type: 'agent_settled' });
}

async function respond(cmd) {
  const reply = data => emit({ type: 'response', id: cmd.id, success: true, data });
  switch (cmd.type) {
    case 'get_state':
      return reply({
        model: { provider: 'demo', id: 'pi2-demo-1' }, thinkingLevel: 'medium',
        isStreaming: stats.streaming, isCompacting: stats.compacting,
        sessionId: SESSION_ID, sessionName: 'demo', messageCount: stats.userMessages * 2,
        pendingMessageCount: 0, steeringMode: 'all', followUpMode: 'one-at-a-time', autoCompactionEnabled: true,
      });
    case 'get_session_stats':
      return reply({
        sessionId: SESSION_ID, userMessages: stats.userMessages, assistantMessages: stats.userMessages * 3,
        toolCalls: stats.toolCalls, toolResults: stats.toolCalls, totalMessages: stats.userMessages * 4,
        tokens: { input: Math.round(stats.tokens * 0.7), output: Math.round(stats.tokens * 0.3), cacheRead: 0, cacheWrite: 0, total: stats.tokens },
        cost: stats.cost,
        contextUsage: { tokens: stats.ctx, contextWindow: 200000, percent: Math.round(stats.ctx / 2000) },
      });
    case 'prompt':
      stats.userMessages++;
      reply({});
      if (stats.streaming) return;
      runDemo(cmd.message || '').catch(() => endRun());
      return;
    case 'steer':
      reply({});
      emit({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: cmd.message || '' }] } });
      emit({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: cmd.message || '' }] } });
      return;
    case 'bash':
      return reply({ exitCode: 0, output: `demo$ ${cmd.command || ''}\n(mock shell — no real execution)` });
    case 'abort': aborted = true; return reply({});
    case 'cycle_model': return reply({ model: { provider: 'demo', id: 'pi2-demo-1' } });
    case 'set_model': return reply({ provider: cmd.provider, id: cmd.modelId });
    case 'get_available_models': return reply({ models: [
      { provider: 'demo', id: 'pi2-demo-1' },
      { provider: 'demo', id: 'pi2-demo-2' },
      { provider: 'openrouter', id: 'google/gemini-flash-latest' },
      { provider: 'openrouter', id: 'anthropic/claude-sonnet-latest' },
      { provider: 'openrouter', id: 'openai/gpt-latest' },
    ] });
    case 'cycle_thinking_level': return reply({ level: 'high' });
    case 'compact': stats.compacting = true; reply({}); setTimeout(() => { stats.compacting = false; stats.ctx = 9000; }, 900); return;
    case 'new_session': stats.userMessages = 0; stats.tokens = 0; stats.cost = 0; stats.ctx = 9000; return reply({ cancelled: false });
    case 'export_html': return reply({ path: join(cwd, 'demo-export.html') });
    case 'extension_ui_response': return;
    default: return reply({});
  }
}

let buf = '';
process.stdin.on('data', d => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let cmd; try { cmd = JSON.parse(line); } catch { continue; }
    respond(cmd);
  }
});
process.stdin.on('end', () => process.exit(0));
