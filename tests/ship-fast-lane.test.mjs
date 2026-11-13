import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shipRoute, smallLaneOverflow, mentionedFiles } from '../lib/ship-route.mjs'
import { registerDelivery } from '../plugins/carthagent/src/server/delivery.ts'
import { shipGuidance, SMALL_LANE_GUIDANCE } from '../plugins/carthagent/src/server/ship-guidance.ts'
import { normalizeSessionOptions } from '../lib/opencode/session-options.mjs'
import { parseOpenCodeArgs } from '../lib/opencode/cli.mjs'

test('router: small edits go to the fast lane', () => {
  for (const ask of [
    "Fix the typo 'recieve' to 'receive' in invest-with-friends/README.md",
    'Rename the variable usr to user in lib/user-add.ts',
    'Add a JSDoc comment to generateMatchName in lib/match-name.ts',
    'Bump the version in package.json to 1.2.0',
    'Reword the error message in app/api/users/add/route.ts to be friendlier',
    'Remove the unused import in lib/market-data.ts',
  ]) assert.equal(shipRoute(ask).route, 'small', ask)
})

test('router: questions are answers, not deliveries', () => {
  for (const ask of ['What test command does this project use?', 'Explain how decideAddUser works', 'Where is the README typo?'])
    assert.equal(shipRoute(ask).route, 'answer', ask)
})

test('router: risky, broad, careful or unclear asks stay on the full flow', () => {
  for (const [ask, reason] of [
    ['Fix the typo in the auth middleware error message in lib/auth.ts', /sensitive/],
    ['Rename the coins column in the voyages migration', /sensitive/],
    ['Bump the version in the release workflow', /sensitive/],
    ['Carefully reword the README', /thorough/],
    ['Rename foo to bar in a.ts, b.ts and c.ts', /several files/],
    ['Add a POST endpoint that lets friends invite each other', /not clearly small/],
    ['Make the dashboard load faster', /not clearly small/],
    ['Fix the typo in the README and then also add a contributing guide', /several parts/],
    ['x'.repeat(300), /long/],
  ]) {
    const result = shipRoute(ask)
    assert.equal(result.route, 'full', ask)
    assert.match(result.reason, reason, ask)
  }
})

test('router: file mentions are found without matching prose', () => {
  assert.deepEqual(mentionedFiles('Edit `lib/a.ts` and README.md, version 1.2'), ['lib/a.ts', 'README.md'])
})

test('fast lane overflow: outside files, too many files or too many lines escalate', () => {
  assert.deepEqual(smallLaneOverflow([{ path: 'README.md', lines: 2 }], ['README.md']), [])
  assert.deepEqual(smallLaneOverflow([{ path: './README.md', lines: 2 }], ['README.md']), [])
  assert.match(smallLaneOverflow([{ path: 'lib/auth.ts', lines: 1 }], ['README.md'])[0], /outside the declared set: lib\/auth\.ts/)
  assert.match(smallLaneOverflow([{ path: 'a', lines: 1 }, { path: 'b', lines: 1 }, { path: 'c', lines: 1 }, { path: 'd', lines: 1 }], ['a', 'b', 'c', 'd']).join(), /4 files/)
  assert.match(smallLaneOverflow([{ path: 'a', lines: 81 }], ['a']).join(), /81 lines/)
})

test('fast lane guidance appears only for small routes in standard mode with no active delivery', () => {
  assert.match(shipGuidance({ state: null, workflow: 'standard', route: 'small' }), /delivery_small/)
  assert.doesNotMatch(shipGuidance({ state: null, workflow: 'standard', route: 'full' }), /delivery_small/)
  assert.doesNotMatch(shipGuidance({ state: null, workflow: 'strict', route: 'small' }), /delivery_small/)
  assert.doesNotMatch(shipGuidance({ state: { status: 'implementing', workflowMode: 'standard' }, workflow: 'standard', route: 'small' }), /delivery_small/)
  assert.doesNotMatch(shipGuidance({ state: null, workflow: 'standard', route: 'small', required: [{ id: 'v' }] }), /delivery_small/)
  assert.ok(SMALL_LANE_GUIDANCE.includes('action=finish'))
})

test('--no-fast-lane is a session option', () => {
  assert.equal(parseOpenCodeArgs(['--no-fast-lane', 'x']).fastLane, false)
  assert.deepEqual(normalizeSessionOptions({ fastLane: false }), { fastLane: false })
})

function repo(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ctg-fast-lane-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' })
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(directory, 'README.md'), '# Title\n\nWe recieve data.\n')
  writeFileSync(join(directory, 'app.js'), 'export const app = 42\n')
  git('add', '.'); git('commit', '-qm', 'init')
  return directory
}

function host(t, directory, options = {}) {
  const tools = new Map(), hooks = new Map(), stores = new Map()
  const ctx = {
    location: { directory }, options,
    session: {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory } }),
      hook: async (name, callback) => { hooks.set(name, callback); return { dispose: async () => hooks.delete(name) } },
      interrupt: async () => {}, prompt: async () => {},
    },
    tool: {
      transform: async callback => { callback({ add: def => tools.set(def.name, def), namespace() {} }); return { dispose: async () => tools.clear() } },
      hook: async (name, callback) => { hooks.set(`tool:${name}`, callback); return { dispose: async () => hooks.delete(`tool:${name}`) } },
    },
    shell: { hook: async (name, callback) => { hooks.set(`shell:${name}`, callback); return { dispose: async () => hooks.delete(`shell:${name}`) } } },
    command: { transform: async () => ({ dispose: async () => {} }) },
    storage: { get: async key => stores.get(key), set: async (key, value) => stores.set(key, structuredClone(value)) },
    event: { subscribe: ({ signal }) => (async function* () { await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })) })() },
  }
  return { ctx, tools, hooks, stores }
}

const call = { sessionID: 'ses-a', signal: new AbortController().signal }
const grepCheck = (id, needle, file) => ({ id, kind: 'test', argv: [process.execPath, '-e', `process.exit(require('fs').readFileSync(${JSON.stringify(file)},'utf8').includes(${JSON.stringify(needle)})?0:1)`], timeoutSeconds: 10 })

test('fast lane: start unlocks edits, finish runs checks fresh and records a verified handoff in one call', async t => {
  const directory = repo(t)
  const h = host(t, directory)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  const before = h.hooks.get('tool:execute.before')
  await assert.rejects(before({ id: 'e0', messageID: 'm', tool: 'edit', sessionID: 'ses-a', input: { path: 'README.md' } }), /delivery_plan/)
  const small = h.tools.get('delivery_small')
  await small.execute({ action: 'start', goal: 'Fix the recieve typo in README.md', files: ['README.md'], checks: [grepCheck('typo-fixed', 'We receive data.', 'README.md')] }, call)
  await before({ id: 'e1', messageID: 'm', tool: 'edit', sessionID: 'ses-a', input: { path: 'README.md' } })
  writeFileSync(join(directory, 'README.md'), '# Title\n\nWe receive data.\n')
  const result = JSON.parse((await small.execute({ action: 'finish', change: 'Fixed the recieve typo in README.md.' }, call)).content)
  assert.equal(result.status, 'verified')
  assert.equal(result.lane, 'small')
  assert.deepEqual(result.checks.map(c => [c.id, c.passed]), [['typo-fixed', true]])
  const report = JSON.parse(readFileSync(result.report, 'utf8'))
  assert.equal(report.status, 'verified')
  assert.equal(report.handoff.lane, 'small')
  assert.equal(report.evidence['typo-fixed'].passed, true)
  await cleanup()
})

test('fast lane: a failing check refuses to verify and asks for a repair', async t => {
  const directory = repo(t)
  const h = host(t, directory)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  const small = h.tools.get('delivery_small')
  await small.execute({ action: 'start', goal: 'Fix the typo', files: ['README.md'], checks: [grepCheck('typo-fixed', 'We receive data.', 'README.md')] }, call)
  await assert.rejects(small.execute({ action: 'finish', change: 'Fixed it.' }, call), /failures[\s\S]*Repair the actual failure/)
  await cleanup()
})

test('fast lane: touching an undeclared file escalates to the full flow with review required', async t => {
  const directory = repo(t)
  const h = host(t, directory)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  const small = h.tools.get('delivery_small')
  await small.execute({ action: 'start', goal: 'Fix the typo', files: ['README.md'], checks: [grepCheck('typo-fixed', 'We receive data.', 'README.md')] }, call)
  writeFileSync(join(directory, 'README.md'), '# Title\n\nWe receive data.\n')
  writeFileSync(join(directory, 'app.js'), 'export const app = 43\n')
  await assert.rejects(small.execute({ action: 'finish', change: 'Fixed it.' }, call), /outgrew the fast lane[\s\S]*app\.js[\s\S]*delivery_review/)
  // The escalated delivery cannot be finished verified without the review gate.
  await h.tools.get('delivery_check').execute({ id: 'all' }, call)
  await assert.rejects(h.tools.get('delivery_finish').execute({ status: 'verified', change: 'x', review: 'x', launch: 'x', limitations: [] }, call), /delivery_review/)
  await assert.rejects(small.execute({ action: 'finish', change: 'Fixed it.' }, call), /No fast-lane delivery is active/)
  await cleanup()
})

test('fast lane: off in strict workflow and with --no-fast-lane; needs files and a real check', async t => {
  const directory = repo(t)
  for (const [options, ctxOptions] of [[{ workflow: 'strict' }, {}], [{ workflow: 'standard' }, { fastLane: false }]]) {
    const h = host(t, directory, ctxOptions)
    const cleanup = await registerDelivery(h.ctx, options)
    await assert.rejects(h.tools.get('delivery_small').execute({ action: 'start', goal: 'g', files: ['README.md'], checks: [grepCheck('c', 'Title', 'README.md')] }, call), /fast lane is off/)
    await cleanup()
  }
  const h = host(t, directory)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await assert.rejects(h.tools.get('delivery_small').execute({ action: 'start', goal: 'g', files: [], checks: [grepCheck('c', 'Title', 'README.md')] }, call), /files/)
  await assert.rejects(h.tools.get('delivery_small').execute({ action: 'start', goal: 'g', files: ['README.md'], checks: [] }, call), /real check/)
  await cleanup()
})

test('framing: small edits get the fast-lane template, others the full one, and both unframe', async () => {
  const { frameShipTask, unframe, framingTemplate, smallFramingTemplate } = await import('../plugins/carthagent/src/server/framing.mjs')
  const small = "Fix the typo 'recieve' in README.md"
  const big = 'Add a POST endpoint that lets friends invite each other'
  assert.match(frameShipTask(small), /^Deliver this small edit/)
  assert.match(frameShipTask(small), /delivery_small\(\{ action: "start"/)
  assert.match(frameShipTask(big), /^Deliver this task in phases/)
  assert.match(frameShipTask(small, { fastLane: false }), /^Deliver this task in phases/)
  assert.equal(unframe(frameShipTask(small)), small)
  assert.equal(unframe(frameShipTask(big)), big)
  assert.ok(framingTemplate().includes('$@') && smallFramingTemplate().includes('$@'))
})

test('delivery_small is reachable before a plan exists (it creates the contract)', async t => {
  const directory = repo(t)
  const h = host(t, directory)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  const before = h.hooks.get('tool:execute.before')
  await before({ id: 's0', messageID: 'm', tool: 'carthagent_delivery_small', sessionID: 'ses-a', input: { action: 'start' } })
  await assert.rejects(before({ id: 'e0', messageID: 'm', tool: 'edit', sessionID: 'ses-a', input: { path: 'README.md' } }), /delivery_plan/)
  await cleanup()
})
