import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { registerDelivery } from '../plugins/carthagent/src/server/delivery.ts'
import { registerShipAgents, SHIP_AGENT_ID, LITE_AGENT_ID } from '../plugins/carthagent/src/server/ship-agents.ts'
import { fixtureDesign, fixtureReview } from './helpers/tested-design.mjs'
import { archiveDeliveryExchanges } from '../plugins/carthagent/src/server/ship-context.mjs'

const signal = () => new AbortController().signal

function host(t, { agent = SHIP_AGENT_ID, files = { 'app.ts': 'export const app = () => 42\n' } } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ctg-ship-parity '))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content)
  const tools = new Map(), hooks = new Map(), commands = new Map(), stores = new Map(), prompts = [], interrupts = []
  const synthetic = []
  const sessions = new Map([['ses-a', { id: 'ses-a', agent, location: { directory } }]])
  let emit
  // Only the OpenCode host boundary is simulated; plans, gates, commands, storage files and archives execute real code.
  const ctx = {
    location: { directory }, options: {},
    model: { list: async () => ({ data: [{ providerID: "p", id: "text-only", capabilities: { input: ["text"] } }] }) },
    session: {
      get: async ({ sessionID }) => ({ ...sessions.get(sessionID), id: sessionID }),
      hook: async (name, callback) => { hooks.set(name, callback); return { dispose: async () => hooks.delete(name) } },
      interrupt: async input => { interrupts.push(input) },
      prompt: async input => { prompts.push(input) },
      synthetic: async input => { synthetic.push(input) },
    },
    tool: {
      transform: async callback => { callback({ add: def => tools.set(def.name, def), namespace() {} }); return { dispose: async () => tools.clear() } },
      hook: async (name, callback) => { hooks.set(`tool:${name}`, callback); return { dispose: async () => hooks.delete(`tool:${name}`) } },
    },
    shell: { hook: async (name, callback) => { hooks.set(`shell:${name}`, callback); return { dispose: async () => hooks.delete(`shell:${name}`) } } },
    command: { transform: async callback => { callback({ add: def => commands.set(def.name, def) }); return { dispose: async () => commands.clear() } } },
    storage: { get: async key => stores.get(key), set: async (key, value) => stores.set(key, structuredClone(value)) },
    event: {
      subscribe: ({ signal: abort }) => (async function* () {
        while (!abort.aborted) {
          const next = await new Promise(resolve => { emit = resolve; abort.addEventListener('abort', () => resolve(null), { once: true }) })
          if (next) yield next
        }
      })(),
    },
  }
  const call = (name, input, agentID = sessions.get('ses-a').agent) => tools.get(name).execute(input, { sessionID: 'ses-a', agent: agentID, signal: signal() })
  const before = (tool, input = {}, id = `${tool}-${Math.random()}`, agentID = sessions.get('ses-a').agent) => hooks.get('tool:execute.before')({ id, messageID: `m-${id}`, tool, sessionID: 'ses-a', agent: agentID, input })
  const after = async (tool, extra = {}, agentID = sessions.get('ses-a').agent) => {
    const event = { id: `a-${Math.random()}`, messageID: 'm', tool, sessionID: 'ses-a', agent: agentID, input: {}, status: 'completed', result: { content: [] }, ...extra }
    await hooks.get('tool:execute.after')(event)
    return event
  }
  const context = async (agentID = sessions.get('ses-a').agent, extra = {}) => {
    const event = { sessionID: 'ses-a', agent: agentID, model: { providerID: 'p', id: 'm' }, system: [], messages: [], options: {}, tools: { edit: {}, carthagent_delivery_plan: {}, carthagent_delivery_status: {}, read: {} }, ...extra }
    await hooks.get('context')(event)
    return event
  }
  const prompt = async text => {
    const event = { sessionID: 'ses-a', messageID: 'msg', prompt: { text }, delivery: 'queue' }
    await hooks.get('prompt')(event)
    return event
  }
  const idle = async () => { emit?.({ type: 'session.idle', data: { sessionID: 'ses-a' } }); await new Promise(resolve => setTimeout(resolve, 30)) }
  const plan = (overrides = {}) => {
    const input = {
      goal: 'Change app output', assumptions: [], artifacts: ['.'], steps: ['Implement'],
      acceptance: [{ requirement: 'app returns 42', checks: ['smoke'] }],
      checks: [{ id: 'smoke', kind: 'test', argv: [process.execPath, '-e', 'process.exit(0)'], timeoutSeconds: 5 }],
      ...overrides,
    }
    return call('delivery_plan', { ...input, design: fixtureDesign(input) })
  }
  return { ctx, tools, hooks, commands, stores, prompts, synthetic, interrupts, sessions, directory, call, before, after, context, prompt, idle, plan }
}

const systemText = event => event.system.map(part => part.text).join('\n')

test('Ship and Lite are native primary agents and Ship is the default mode', async () => {
  const agents = new Map(); let defaultID
  const editor = { update: (id, fn) => { const item = agents.get(id) ?? { id, permissions: [] }; agents.set(id, item); fn(item) }, default: id => { defaultID = id } }
  const dispose = await registerShipAgents({ agent: { transform: async callback => { callback(editor); return { dispose: async () => {} } } } })
  assert.equal(defaultID, SHIP_AGENT_ID)
  assert.equal(agents.get(SHIP_AGENT_ID).mode, 'primary')
  assert.equal(agents.get(LITE_AGENT_ID).mode, 'primary')
  assert.equal(agents.get(SHIP_AGENT_ID).system, undefined, 'Ship keeps the native base prompt; delivery guidance arrives per request')
  assert.doesNotMatch(JSON.stringify([...agents.values()]), /todowrite/)
  await dispose()
})

test('delivery guidance is injected on the first Ship turn, before any prompt hook state exists', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  const event = await h.context()
  assert.match(systemText(event), /Preserve every user requirement/)
  assert.match(systemText(event), /Standard delivery: inspect relevant files/)
  await cleanup()
})

test('the harness is scoped to Ship: Lite, Plan and Build get no guidance, locks, delivery tools or repairs', async t => {
  for (const agent of [LITE_AGENT_ID, 'plan', 'build']) {
    const h = host(t, { agent })
    const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
    const event = await h.context()
    assert.equal(systemText(event), '', `${agent}: no delivery system guidance`)
    assert.ok(event.tools.edit, `${agent}: implementation tools stay available`)
    assert.equal(event.tools.carthagent_delivery_plan, undefined, `${agent}: delivery tools hidden`)
    await h.before('edit', { path: 'app.ts' })
    await assert.rejects(h.plan(), /Ship/)
    const framed = await h.prompt('build a web dashboard')
    assert.equal(framed.prompt.text, 'build a web dashboard')
    await cleanup()
  }
})

test('switching away from Ship mid-session stops enforcement; switching back restores it', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await assert.rejects(h.before('edit', { path: 'app.ts' }), /delivery_plan/)
  h.sessions.get('ses-a').agent = LITE_AGENT_ID
  await h.before('edit', { path: 'app.ts' })
  h.sessions.get('ses-a').agent = SHIP_AGENT_ID
  await assert.rejects(h.before('edit', { path: 'app.ts' }), /delivery_plan/)
  await cleanup()
})

test('an unknown session agent fails closed to the Ship harness', async t => {
  const h = host(t)
  delete h.sessions.get('ses-a').agent
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await assert.rejects(h.before('edit', { path: 'app.ts' }, 'x', undefined), /delivery_plan/)
  await cleanup()
})

test('standard guidance matches legacy text, including browser, image and test infrastructure guidance', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await h.prompt('build a browser frontend with a typescript api route')
  const text = systemText(await h.context(SHIP_AGENT_ID, { model: { providerID: 'p', id: 'text-only' }, modelCapabilities: { input: ['text'] } }))
  assert.match(text, /self-contained browser check is available/)
  assert.match(text, /Test infrastructure: reuse the installed runner/)
  assert.match(text, /cannot process images/)
  await cleanup()
})

test('routed guidance profiles persist into the plan and stay active for follow-ups', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await h.prompt('build a web application with a login page and browser UI')
  await h.plan()
  const saved = h.stores.get('session/ses-a')
  assert.ok(saved.state.guidanceProfiles.length > 0)
  await h.prompt('continue')
  assert.match(systemText(await h.context()), /web/i)
  await cleanup()
})

test('repeated unchanged delivery_status calls are blocked after three polls', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await h.plan()
  for (let i = 0; i < 3; i++) await h.before('delivery_status', {}, `status-${i}`)
  await assert.rejects(h.before('delivery_status', {}, 'status-4'), /Repeated unchanged delivery_status/)
  await cleanup()
})

test('protect-existing blocks shell redirection, scripted replacement and rm of original files', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard', protectExisting: true })
  await h.plan()
  await assert.rejects(h.before('shell', { command: 'echo x > app.ts' }), /redirection/)
  await assert.rejects(h.before('shell', { command: "node -e \"require('fs').writeFileSync('app.ts','')\"" }), /script cannot replace/)
  await assert.rejects(h.before('shell', { command: 'rm app.ts' }), /remove or replace/)
  await cleanup()
})

test('broad process termination patterns match legacy, including Windows forms', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await h.plan()
  for (const command of ['taskkill /IM node.exe /F', 'Stop-Process -Name node', 'Get-Process node | Stop-Process', 'pkill node']) {
    await assert.rejects(h.before('shell', { command }), /Broad process termination/, command)
  }
  await cleanup()
})

test('rewrite cap counts whole-file writes only, never focused edits', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard', rewriteCap: 1 })
  await h.plan()
  await h.before('write', { path: 'new.ts', content: 'a' })
  for (let i = 0; i < 3; i++) await h.before('edit', { path: 'new.ts' })
  await assert.rejects(h.before('write', { path: 'new.ts', content: 'b' }), /rewrite limit/)
  await cleanup()
})

test('blocked implementation attempts during discovery produce the pre-plan checkpoint', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'strict' })
  await h.prompt('implement a feature that changes the app')
  await assert.rejects(h.before('edit', { path: 'app.ts' }, 'b1'))
  await assert.rejects(h.before('edit', { path: 'app.ts' }, 'b2'), /Pre-plan checkpoint/)
  await cleanup()
})

test('repeated failing probes append the infrastructure diagnostic checkpoint', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await h.plan()
  const failing = { status: 'completed', result: { content: [{ type: 'text', text: 'Error: Cannot find module x\nexited with code 1' }] } }
  await h.after('shell', structuredClone(failing))
  const second = structuredClone(failing)
  const observed = await h.after('shell', second)
  assert.match(JSON.stringify(observed.result.content), /Diagnostic checkpoint/)
  await cleanup()
})

test('turn delay paces tool results like legacy bounded runs', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard', turnDelayMs: 60 })
  const started = Date.now()
  await h.after('read')
  assert.ok(Date.now() - started >= 55)
  await cleanup()
})

test('design review normalizes captureId beside the action, flattened fields and echoed id', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'strict' })
  await h.plan()
  await h.call('delivery_design', { action: 'validate' })
  const inspected = JSON.parse((await h.call('delivery_design', { action: 'inspect' })).content)
  const result = JSON.parse((await h.call('delivery_design', { action: 'review', captureId: inspected.captureId, ...fixtureReview(inspected.result.plan) })).content)
  assert.doesNotMatch(JSON.stringify(result), /captureId is required|missing capture/i)
  await cleanup()
})

test('Jev uses the native OAuth credential, runs once per capture identity, and remains advisory', async t => {
  const h = host(t)
  let calls = 0
  const previous = process.env.CARTHAGENT_CLOUD_URL
  t.after(() => { if (previous === undefined) delete process.env.CARTHAGENT_CLOUD_URL; else process.env.CARTHAGENT_CLOUD_URL = previous })
  const server = createServer(async (request, response) => {
    calls++
    assert.equal(request.url, '/v1/jev')
    assert.equal(request.headers.authorization, 'Bearer native-fixture-credential')
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    assert.equal(body.state.goal, 'Change app output')
    assert.equal(h.stores.get('session/ses-a').state.advisorAttempts.length, 1, 'attempt persisted before transport dispatch')
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: 'jev-latest', answers: { srp: { type: 'noul', noul: 0.6 }, di: { type: 'noul', noul: 0.1 }, tests: { type: 'noul', noul: 0.2 } } }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  process.env.CARTHAGENT_CLOUD_URL = `http://127.0.0.1:${server.address().port}`
  // Native credential resolution is a host boundary; the actual Jev HTTP client runs against loopback.
  h.ctx.integration = { connection: {
    active: async () => ({ type: 'credential', method: 'oauth' }),
    resolve: async () => ({ type: 'oauth', methodID: 'carthagent-device', access: 'native-fixture-credential' }),
  } }
  const cleanup = await registerDelivery(h.ctx, { workflow: 'strict' })
  h.sessions.get('ses-a').model = { providerID: 'experiential-labs', id: 'ship-model' }
  await h.plan()
  await h.call('delivery_design', { action: 'validate' })
  const inspected = JSON.parse((await h.call('delivery_design', { action: 'inspect' })).content)
  assert.equal(inspected.advice.mode, 'shadow')
  assert.equal(inspected.advice.authority, 'none')
  assert.equal(calls, 1)
  await assert.rejects(h.before('edit', { path: 'app.ts' }), /locked/)
  const again = JSON.parse((await h.call('delivery_design', { action: 'inspect' })).content)
  assert.equal(again.advice.reused, true)
  assert.equal(calls, 1)
  h.sessions.get('ses-a').model = { providerID: 'other', id: 'model' }
  const other = JSON.parse((await h.call('delivery_design', { action: 'inspect' })).content)
  assert.equal(other.advice.mode, 'disabled')
  assert.equal(calls, 1)
  await cleanup()
})

test('delivery_check routes passing checks to the handoff action', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await h.plan()
  const result = JSON.parse((await h.call('delivery_check', { id: 'all' })).content)
  assert.match(result.next, /delivery_finish/)
  await cleanup()
})

test('advisory commands cannot bypass approval and informational finish stays available', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await h.plan({ verification: 'advisory', checks: [{ id: 'smoke', kind: 'test', argv: [process.execPath, '-e', 'process.exit(1)'], timeoutSeconds: 5 }] })
  await assert.rejects(h.call('delivery_check', { id: 'all' }), /Implementation locked/)
  const done = JSON.parse((await h.call('delivery_finish', { status: 'verified', review: 'Check was not authorized; informational handoff only.', launch: 'not run', limitations: ['No execution evidence.'] })).content)
  assert.deepEqual(done.advisoryFailures, [])
  assert.match(done.note, /Informational\/advisory finish/)
  await cleanup()
})

test('required validators added on restore force status back to verifying', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await h.plan()
  await h.call('delivery_check', { id: 'all' })
  await cleanup()
  writeFileSync(join(h.directory, 'validators.json'), JSON.stringify({ version: 1, checks: [{ id: 'user-gate', kind: 'test', argv: [process.execPath, '-e', '0'], timeoutSeconds: 5 }] }))
  const again = await registerDelivery(h.ctx, { workflow: 'standard', validators: 'validators.json' })
  const status = JSON.parse((await h.call('delivery_status', {})).content)
  assert.equal(status.status, 'verifying')
  await again()
})

test('repair nudges quote failing check output tails and only follow a succeeded Ship turn', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await h.plan({ checks: [{ id: 'smoke', kind: 'test', argv: [process.execPath, '-e', 'console.log("boom-tail"); process.exit(3)'], timeoutSeconds: 5 }] })
  await h.after('edit')
  await assert.rejects(h.call('delivery_check', { id: 'all' }))
  h.sessions.get('ses-a').outcome = 'succeeded'
  await h.idle()
  assert.equal(h.prompts.length, 1)
  assert.match(h.prompts[0].text, /boom-tail/)
  assert.match(h.prompts[0].text, /exit 3/)
  h.sessions.get('ses-a').agent = LITE_AGENT_ID
  await h.idle()
  assert.equal(h.prompts.length, 1, 'Lite turns never trigger delivery repairs')
  await cleanup()
})

test('context metrics are recorded per Ship request and pressure warnings appear past 240KB', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await h.plan()
  const big = [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(260_000) }] }]
  await h.context(SHIP_AGENT_ID, { messages: structuredClone(big) })
  const event = await h.context(SHIP_AGENT_ID, { messages: structuredClone(big) })
  const runId = h.stores.get('session/ses-a').state.runId
  const metrics = join(h.directory, '.harness', 'ses-a', runId, 'context-metrics.jsonl')
  assert.ok(existsSync(metrics))
  assert.ok(readFileSync(metrics, 'utf8').trim().split('\n').length >= 2)
  assert.match(systemText(event), /Context pressure/)
  await cleanup()
})

test('successful delivery exchanges are archived after approval while recent ones stay inline', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'strict' })
  await h.plan()
  await h.call('delivery_design', { action: 'validate' })
  const inspected = JSON.parse((await h.call('delivery_design', { action: 'inspect' })).content)
  await h.call('delivery_design', { action: 'review', captureId: inspected.captureId, review: fixtureReview(inspected.result.plan) })
  await h.call('delivery_design', { action: 'approve' })
  const exchange = n => [
    { role: 'assistant', content: [{ type: 'tool-call', id: `c${n}`, name: 'carthagent_delivery_status', input: {} }] },
    { role: 'tool', content: [{ type: 'tool-result', id: `c${n}`, name: 'carthagent_delivery_status', result: { type: 'text', value: `ok ${n}` } }] },
  ]
  const messages = [...exchange(1), ...exchange(2), ...exchange(3), ...exchange(4)]
  const event = await h.context(SHIP_AGENT_ID, { messages })
  const archived = event.messages.filter(m => JSON.stringify(m).includes('Archived successful delivery exchange'))
  assert.equal(archived.length, 2)
  assert.equal(event.messages.filter(m => m.role === 'tool').length, 2)
  await cleanup()
})

test('Ship registers the bundled delivery skills', async () => {
  const added = []
  const { registerShipSkills } = await import('../plugins/carthagent/src/server/ship-agents.ts')
  const dispose = await registerShipSkills({ skill: { transform: async callback => { callback({ add: skill => added.push(skill), get: () => undefined }); return { dispose: async () => {} } } } })
  assert.deepEqual(added.map(skill => skill.id).sort(), ['game-development', 'software-delivery', 'typescript-delivery'])
  assert.ok(added.every(skill => skill.content.length > 100 && skill.path.endsWith('SKILL.md')))
  await dispose()
})


test('native output caps keep the tail, preserve files, and leave delivery evidence intact', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard', toolOutputCap: 12 })
  const output = 'prefix secret-looking fixture text tail-content'
  const result = await h.after('read', { result: { content: [{ type: 'text', text: output }, { type: 'file', uri: 'file:///fixture.png', mime: 'image/png' }] } })
  assert.match(result.result.content[0].text, /^tail-content/)
  assert.equal(result.result.content[1].type, 'file')
  await h.plan()
  const evidence = await h.after('carthagent_delivery_check', { result: { content: [{ type: 'text', text: output }] } })
  assert.equal(evidence.result.content[0].text, output)
  await cleanup()
})

test('post-check scope failures retain failed evidence and still permit an honest blocked handoff', async t => {
  const h = host(t)
  const previous = process.env.CARTHAGENT_MAX_FILES
  process.env.CARTHAGENT_MAX_FILES = '1'
  t.after(() => { if (previous === undefined) delete process.env.CARTHAGENT_MAX_FILES; else process.env.CARTHAGENT_MAX_FILES = previous })
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await h.plan({ checks: [{ id: 'smoke', kind: 'test', argv: [process.execPath, '-e', 'require("fs").writeFileSync("extra.ts", "export const extra = 1")'], timeoutSeconds: 5 }] })
  await assert.rejects(h.call('delivery_check', { id: 'all' }), /Post-check evidence scope error:.*delivery_finish/)
  const state = h.stores.get('session/ses-a').state
  assert.equal(state.evidence.smoke.passed, false)
  assert.equal(state.evidence.smoke.fingerprint, null)
  assert.ok(existsSync(state.evidence.smoke.logPath))
  const finished = JSON.parse((await h.call('delivery_finish', { status: 'blocked', review: 'Scope could not be established.', launch: 'not run', limitations: ['Evidence scope exceeds configured limit.'] })).content)
  assert.equal(finished.status, 'blocked')
  await cleanup()
})

test('protect-existing captures only session-start files, not new files written later', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard', protectExisting: true })
  await h.plan()
  await h.before('write', { path: 'new.ts', content: 'one' })
  writeFileSync(join(h.directory, 'new.ts'), 'one')
  await h.before('write', { path: 'new.ts', content: 'two' })
  await assert.rejects(h.before('write', { path: 'app.ts', content: 'overwrite' }), /Preserve existing/)
  await cleanup()
})

test('direct and Code Mode results expose the authoritative plan snapshot', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  const plan = await h.plan()
  assert.equal(plan.metadata.deliveryPlan.items[0].status, 'pending')
  await h.call('delivery_progress', { step: 0, status: 'active' })
  const outer = await h.after('execute')
  assert.equal(outer.result.metadata.deliveryPlan.items[0].status, 'active')
  assert.equal(outer.result.metadata.deliveryPlan.runId, plan.metadata.deliveryPlan.runId)
  await cleanup()
})

test('budget exhaustion remains enforced when delivery participation is disabled', async t => {
  const h = host(t, { agent: LITE_AGENT_ID })
  const cleanup = await registerDelivery(h.ctx, { maxTools: 1 })
  await h.before('read')
  await assert.rejects(h.before('read'), /budget exhausted/)
  await assert.rejects(h.context(), /budget exhausted/)
  assert.equal(h.interrupts.length, 2)
  await cleanup()
})


test('Code Mode wrappers and reads do not reset repeated unchanged status polling', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await h.plan()
  for (let i = 0; i < 3; i++) {
    await h.before('execute', {}, `execute-status-${i}`)
    await h.before('carthagent_delivery_status', {}, `nested-status-${i}`)
    await h.before('read', { path: 'app.ts' })
  }
  await h.before('execute', {}, 'execute-status-4')
  await assert.rejects(h.before('carthagent_delivery_status', {}, 'nested-status-4'), /Repeated unchanged/)
  writeFileSync(join(h.directory, 'app.ts'), 'export const app = () => 43')
  await h.before('carthagent_delivery_status', {}, 'changed-status')
  await cleanup()
})

test('budget commands report and reset without triggering a model turn', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { maxTools: 1 })
  await h.before('read')
  await assert.rejects(h.before('read'), /budget exhausted/)
  await h.commands.get('delivery-budget-status').execute({ sessionID: 'ses-a' })
  assert.match(h.synthetic[0].text, /tool-calls/)
  await h.commands.get('delivery-budget-reset').execute({ sessionID: 'ses-a' })
  assert.equal(h.stores.get('session/ses-a').budget.tools, 0)
  assert.equal(h.stores.get('session/ses-a').budget.stopped, null)
  assert.equal(h.synthetic.every(message => message.resume === false), true)
  assert.deepEqual(h.prompts, [])
  await h.before('read')
  await cleanup()
})

test('strict approval, recovery and evidence survive a native plugin restart', async t => {
  const h = host(t)
  const first = await registerDelivery(h.ctx, { workflow: 'strict' })
  await h.plan()
  await h.call('delivery_design', { action: 'validate' })
  const inspected = JSON.parse((await h.call('delivery_design', { action: 'inspect' })).content)
  await h.call('delivery_design', { action: 'review', review: { ...fixtureReview(inspected.result.plan), id: inspected.captureId } })
  await h.call('delivery_design', { action: 'approve' })
  await first()
  const second = await registerDelivery(h.ctx, { workflow: 'standard' })
  await h.before('edit', { path: 'app.ts' })
  await h.call('delivery_check', { id: 'all' })
  const event = { sessionID: 'ses-a', agent: SHIP_AGENT_ID, system: [] }
  await h.hooks.get('compaction')(event)
  assert.match(systemText(event), /app returns 42/)
  assert.match(systemText(event), /smoke/)
  assert.equal(h.stores.get('session/ses-a').state.workflowMode, 'strict')
  await second()
})

test('terminal native runs do not reinsert checkpoints during compaction or queue repair turns', async t => {
  const h = host(t)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await h.plan()
  await h.call('delivery_finish', { status: 'blocked', review: 'Cannot proceed.', launch: 'not run', limitations: ['External dependency unavailable.'] })
  const event = { sessionID: 'ses-a', agent: SHIP_AGENT_ID, system: [] }
  await h.hooks.get('compaction')(event)
  assert.deepEqual(event.system, [])
  h.sessions.get('ses-a').outcome = 'succeeded'
  await h.idle()
  assert.deepEqual(h.prompts, [])
  await cleanup()
})


test('context archival retains original failures, mixed messages, and content when storage fails', t => {
  const h = host(t)
  const call = { role: 'assistant', content: [{ type: 'tool-call', id: 'archive-call', name: 'carthagent_delivery_check', input: { id: 'all' } }] }
  const failed = { role: 'tool', content: [{ type: 'tool-result', id: 'archive-call', name: 'carthagent_delivery_check', result: { type: 'text', value: '{"passed":false,"outputTail":"failure"}' } }] }
  const failure = [call, failed]
  assert.deepEqual(archiveDeliveryExchanges(failure, { cwd: h.directory, directory: h.directory, allow: true, keepRecent: 0 }).messages, failure)
  const mixed = [{ ...call, content: [...call.content, { type: 'text', text: 'Keep this reasoning.' }] }, { ...failed, content: [{ ...failed.content[0], result: { type: 'text', value: 'ok' } }] }]
  assert.deepEqual(archiveDeliveryExchanges(mixed, { cwd: h.directory, directory: h.directory, allow: true, keepRecent: 0 }).messages, mixed)
  const success = [call, { ...failed, content: [{ ...failed.content[0], result: { type: 'text', value: 'ok' } }] }]
  const obstructed = join(h.directory, 'not-a-directory')
  writeFileSync(obstructed, 'original file')
  const retained = archiveDeliveryExchanges(success, { cwd: h.directory, directory: obstructed, allow: true, keepRecent: 0 })
  assert.equal(retained.failed, true)
  assert.deepEqual(retained.messages, success)
  assert.equal(readFileSync(obstructed, 'utf8'), 'original file')
})
