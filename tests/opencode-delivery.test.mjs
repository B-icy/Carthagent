import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerDelivery } from '../plugins/carthagent/src/server/delivery.ts'
import { registerCodegraph } from '../plugins/carthagent/src/server/codegraph.ts'
import { checkBudget, budgetForSession, readBudgetLimits } from '../plugins/carthagent/src/server/budgets.ts'
import { requiresPlanApproval } from '../plugins/carthagent/src/server/policy.ts'

function host(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ctg-opencode-worktree '))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(join(directory, 'app.ts'), 'export function app() { return 42 }\n')
  const tools = new Map(), hooks = new Map(), commands = new Map(), stores = new Map(), events = []
  const session = { id: 'ses-a', location: { directory } }
  const sessions = new Map()
  sessions.set(session.id, session)
  const ctx = {
    location: { directory }, options: {},
    session: {
      get: async ({ sessionID }) => { assert.ok(sessionID); return { ...session, ...sessions.get(sessionID), id: sessionID } },
      hook: async (name, callback) => { hooks.set(name, callback); return { dispose: async () => hooks.delete(name) } },
      interrupt: async () => {},
      prompt: async () => {},
    },
    tool: {
      transform: async callback => { callback({ add: def => tools.set(def.name, def), namespace() {} }); return { dispose: async () => tools.clear() } },
      hook: async (name, callback) => { hooks.set(`tool:${name}`, callback); return { dispose: async () => hooks.delete(`tool:${name}`) } },
    },
    shell: { hook: async (name, callback) => { hooks.set(`shell:${name}`, callback); return { dispose: async () => hooks.delete(`shell:${name}`) } } },
    command: { transform: async callback => { callback({ add: def => commands.set(def.name, def) }); return { dispose: async () => commands.clear() } } },
    storage: {
      get: async key => stores.get(key),
      set: async (key, value) => stores.set(key, structuredClone(value)),
    },
    event: { subscribe: ({ signal }) => { events.push(signal); return (async function* () { await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })) })() } },
  }
  return { ctx, tools, hooks, commands, stores, directory, session, sessions }
}

test('OpenCode V2 registration exposes domain tools and returns complete cleanup', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  assert.deepEqual([...h.tools.keys()].sort(), ['delivery_check', 'delivery_design', 'delivery_finish', 'delivery_plan', 'delivery_progress', 'delivery_review', 'delivery_status', 'delivery_probe', 'delivery_revise'].sort())
  assert.deepEqual([...h.commands.keys()].sort(), ['delivery-budget-reset', 'delivery-budget-status'])
  assert.ok(h.hooks.has('prompt'))
  assert.ok(h.hooks.has('context'))
  assert.ok(h.hooks.has('compaction'))
  assert.ok(h.hooks.has('tool:execute.before'))
  assert.ok(h.hooks.has('shell:create.before'))
  await cleanup()
  assert.equal(h.tools.size, 0)
  assert.equal(h.hooks.size, 0)
  assert.equal(h.commands.size, 0)
  assert.ok([...h.hooks.keys()].length === 0)
})

test('session-scoped plan is stored and implementation cannot start before plan', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  const before = h.hooks.get('tool:execute.before')
  await assert.rejects(before({ tool: 'edit', sessionID: 'ses-a', input: { path: 'app.ts' } }), /delivery_plan/)
  const plan = h.tools.get('delivery_plan')
  const result = await plan.execute({
    goal: 'Preserve runnable application behavior', assumptions: [], artifacts: ['.'], steps: ['Implement behavior'],
    acceptance: [{ requirement: 'Application returns expected value', checks: ['smoke'] }],
    checks: [{ id: 'smoke', kind: 'test', argv: [process.execPath, '-e', 'process.exit(0)'], timeoutSeconds: 5 }],
  }, { sessionID: 'ses-a', signal: new AbortController().signal })
  assert.match(result.content, /report\.json/)
  assert.ok(h.stores.has('session/ses-a'))
  await before({ tool: 'edit', sessionID: 'ses-a', input: { path: 'app.ts' } })
  await cleanup()
})

test('code navigation resolves the session worktree, not plugin startup location', async t => {
  const h = host(t)
  const wrong = mkdtempSync(join(tmpdir(), 'ctg-opencode-plugin-location '))
  t.after(() => rmSync(wrong, { recursive: true, force: true }))
  writeFileSync(join(wrong, 'different.ts'), 'export function different() {}\n')
  h.ctx.location.directory = wrong
  let tool
  await registerCodegraph({ ...h.ctx, tool: { transform: async callback => { callback({ add: definition => { tool = definition } }); return { dispose: async () => {} } } } })
  h.session.location.directory = wrong
  const result = await tool.execute({ op: 'definition', name: 'different' }, { sessionID: 'ses-a', signal: new AbortController().signal })
  assert.match(result.content, /\"op\":\"definition\"/)
  assert.match(result.content, /different\.ts/)
})

test('policy and budget adapters preserve strict semantics and explicit reset', () => {
  assert.equal(requiresPlanApproval('edit'), true)
  assert.equal(requiresPlanApproval('read'), false)
  const limits = readBudgetLimits({ 'delivery-max-tools': '1', 'delivery-max-seconds': '0', 'delivery-max-repairs': '1' })
  const budget = budgetForSession(undefined, limits)
  assert.equal(checkBudget(budget, 'tool'), null)
  assert.equal(checkBudget(budget, 'tool'), 'tool-calls')
  const resumed = budgetForSession(budget, { tools: 100, seconds: 100, repairs: 100 })
  assert.equal(resumed.tools, 1)
})

test('same-worktree sessions with identical concurrent shell commands fail closed instead of borrowing each other’s budget', async t => {
  const h = host(t)
  h.sessions.set('ses-b', { id: 'ses-b', location: { directory: h.directory } })
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  const plan = h.tools.get('delivery_plan')
  const input = {
    goal: 'Create a fixture', assumptions: [], artifacts: ['fixture.txt'], steps: ['Create fixture'],
    acceptance: [{ requirement: 'fixture exists', checks: ['fixture-check'] }],
    checks: [{ id: 'fixture-check', kind: 'test', argv: [process.execPath, '-e', 'process.exit(0)'], timeoutSeconds: 5 }],
  }
  await plan.execute(input, { sessionID: 'ses-a', signal: new AbortController().signal })
  const before = h.hooks.get('tool:execute.before')
  const after = h.hooks.get('tool:execute.after')
  const shell = h.hooks.get('shell:create.before')
  const command = 'node -e "process.exit(0)"'
  await before({ id: 'call-a', tool: 'bash', sessionID: 'ses-a', input: { command } })
  await plan.execute(input, { sessionID: 'ses-b', signal: new AbortController().signal })
  await before({ id: 'call-b', tool: 'bash', sessionID: 'ses-b', input: { command } })
  await assert.rejects(shell({ cwd: h.directory, command, timeout: 5000 }), /missing or ambiguous/)
  await after({ id: 'call-a', tool: 'bash', sessionID: 'ses-a', status: 'completed', input: { command } })
  await after({ id: 'call-b', tool: 'bash', sessionID: 'ses-b', status: 'completed', input: { command } })
  assert.equal(h.stores.get('session/ses-a').budget.tools, 0)
  assert.equal(h.stores.get('session/ses-b').budget.tools, 0)
  await cleanup()
})

test('delivery:false disables workflow hooks and tools per session but retains native budget charging', async t => {
  const h = host(t)
  h.sessions.set('ses-off', {
    id: 'ses-off', location: { directory: h.directory }, metadata: { 'carthagent.options': { delivery: false } },
  })
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  const before = h.hooks.get('tool:execute.before')
  const sessionState = async () => h.stores.get('session/ses-off')
  const limits = readBudgetLimits({ maxTools: 3, maxSeconds: 0, maxRepairs: 0 })
  h.stores.set('session/ses-off', { state: null, discovery: {}, nudges: 0, touched: false, budget: budgetForSession(undefined, limits), required: [], initialFiles: [], cwd: h.directory })
  await before({ id: 'edit-off', tool: 'edit', sessionID: 'ses-off', input: { path: 'app.ts' } })
  const state = await sessionState()
  state.budget.limits.tools = 3
  h.stores.set('session/ses-off', state)
  await before({ id: 'shell-off', tool: 'bash', sessionID: 'ses-off', input: { command: 'printf off' } })
  await h.hooks.get('shell:create.before')({ cwd: h.directory, command: 'printf off', timeout: 5000 })
  await assert.rejects(h.tools.get('delivery_plan').execute({ goal: 'Disabled workflow' }, {
    sessionID: 'ses-off', signal: new AbortController().signal,
  }), /disabled for this session/)
  assert.equal(h.stores.get('session/ses-off').budget.tools, 1)
  assert.equal(h.stores.has('session/ses-off') && h.stores.get('session/ses-off').state, null)
  await cleanup()
})
