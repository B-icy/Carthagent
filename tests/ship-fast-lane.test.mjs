import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shipRoute, smallLaneOverflow, mentionedFiles } from '../lib/ship-route.mjs'
import { smallLaneKind, smallLaneFileViolation, codeSkeleton } from '../lib/small-lane-diff.mjs'
import { registerDelivery } from '../plugins/carthagent/src/server/delivery.ts'
import { shipGuidance, SMALL_LANE_GUIDANCE } from '../plugins/carthagent/src/server/ship-guidance.ts'
import { normalizeSessionOptions } from '../lib/opencode/session-options.mjs'
import { parseOpenCodeArgs } from '../lib/opencode/cli.mjs'

const { cases: routeCases } = JSON.parse(readFileSync(new URL('./fixtures/ship-routes.json', import.meta.url), 'utf8'))

test('router: no labelled full request ever routes to the fast lane (safety gate)', () => {
  const risky = routeCases.filter(c => c.want !== 'small' && shipRoute(c.ask).route === 'small')
  assert.deepEqual(risky.map(c => `${c.ask} (${shipRoute(c.ask).reason})`), [])
})

test('router: labelled small edits take the fast lane and questions are answers', () => {
  const slow = routeCases.filter(c => c.want === 'small' && shipRoute(c.ask).route !== 'small')
  assert.deepEqual(slow.map(c => `${c.ask} (${shipRoute(c.ask).reason})`), [])
  for (const c of routeCases.filter(c => c.want === 'answer')) assert.equal(shipRoute(c.ask).route, 'answer', c.ask)
})

test('router: file names are targets, not topics', () => {
  assert.equal(shipRoute('Bump lodash to 4.17.21 in package.json').route, 'small')
  assert.equal(shipRoute('Fix the typo in config/deploy.yml comments').route, 'full')
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
  await assert.rejects(small.execute({ action: 'finish', change: 'Fixed it.' }, call), /not a small text edit[\s\S]*app\.js[\s\S]*delivery_review/)
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

test('content guard: a "typo" lane may only change comments, strings and text', () => {
  const ts = 'const a = 1 // recieve\nexport const msg = "We recieve data"\nif (a > 0) run()\n'
  assert.equal(smallLaneFileViolation('text', 'lib/x.ts', ts, ts.replace('// recieve', '// receive')), '')
  assert.equal(smallLaneFileViolation('text', 'lib/x.ts', ts, ts.replace('"We recieve data"', '"We receive data"')), '')
  assert.match(smallLaneFileViolation('text', 'lib/x.ts', ts, ts.replace('a > 0', 'a >= 0')), /code changed/)
  assert.match(smallLaneFileViolation('text', 'lib/x.ts', ts, ts.replace('run()', 'run(); exit()')), /code changed/)
  // Template literal: text may change, the ${} code may not.
  const tpl = 'const s = `Hello ${name}!`\n'
  assert.equal(smallLaneFileViolation('text', 'a.js', tpl, tpl.replace('Hello', 'Hi')), '')
  assert.match(smallLaneFileViolation('text', 'a.js', tpl, tpl.replace('${name}', '${user}')), /code changed/)
  // JSX text children are copy.
  const jsx = 'export const B = () => <button onClick={buy}>Buy now</button>\n'
  assert.equal(smallLaneFileViolation('text', 'B.tsx', jsx, jsx.replace('Buy now', 'Purchase')), '')
  assert.match(smallLaneFileViolation('text', 'B.tsx', jsx, jsx.replace('onClick={buy}', 'onClick={sell}')), /code changed/)
  // Attribute values: copy attributes are text, the rest are code.
  const attr = '<img alt="Logo" className="logo" src="/a.png" />\n'
  assert.equal(smallLaneFileViolation('text', 'L.tsx', attr, attr.replace('alt="Logo"', 'alt="Company logo"')), '')
  assert.match(smallLaneFileViolation('text', 'L.tsx', attr, attr.replace('"logo"', '"logo hidden"')), /code changed/)
  assert.match(smallLaneFileViolation('text', 'p.html', '<a href="/a">Home</a>', '<a href="/b">Home</a>'), /code changed/)
  // Python docstrings and comments are text; code is not.
  const py = 'def f(x):\n    """Retrun x."""\n    return x  # ok\n'
  assert.equal(smallLaneFileViolation('text', 'm.py', py, py.replace('Retrun', 'Return')), '')
  assert.match(smallLaneFileViolation('text', 'm.py', py, py.replace('return x ', 'return x + 1 ')), /code changed/)
  // Docs are text; unknown file types are refused.
  assert.equal(smallLaneFileViolation('text', 'README.md', '# Tilte', '# Title'), '')
  assert.match(smallLaneFileViolation('text', 'Makefile', 'a:\n\techo', 'a:\n\techo hi'), /not checked/)
})

test('content guard: rename, imports, whitespace and bump each allow only their change', () => {
  const ts = 'const usr = load()\nsave(usr)\n'
  assert.equal(smallLaneFileViolation('rename', 'a.ts', ts, ts.replaceAll('usr', 'user')), '')
  assert.match(smallLaneFileViolation('rename', 'a.ts', ts, 'const user = load()\nsave(usr)\n'), /beyond one consistent rename/)
  assert.match(smallLaneFileViolation('rename', 'a.ts', ts, ts.replaceAll('usr', 'save')), /beyond one consistent rename/)
  const imp = "import { a, b } from './x'\nimport z from 'z'\nuse(a)\n"
  assert.equal(smallLaneFileViolation('imports', 'a.ts', imp, "import { a } from './x'\nuse(a)\n"), '')
  assert.match(smallLaneFileViolation('imports', 'a.ts', imp, "import { a } from './x'\nuse(b)\n"), /outside import/)
  assert.equal(smallLaneFileViolation('whitespace', 'a.ts', 'f( 1 )\n', 'f(1)\n'), '')
  assert.match(smallLaneFileViolation('whitespace', 'a.py', 'if x:\n    y()\nz()\n', 'if x:\n    y()\n    z()\n'), /indentation is code/)
  const pkg = '{"dependencies":{"lodash":"4.17.20"}}'
  assert.equal(smallLaneFileViolation('bump', 'package.json', pkg, pkg.replace('4.17.20', '4.17.21')), '')
  assert.match(smallLaneFileViolation('bump', 'package.json', pkg, pkg.replace('"lodash"', '"lodash-es"')), /more than version/)
  assert.match(smallLaneFileViolation('bump', 'lib/a.ts', 'v="1.0.0"', 'v="1.0.1"'), /manifest/)
})

test('content guard: request wording picks the lane kind', () => {
  assert.equal(smallLaneKind("Fix the typo 'recieve' in README.md"), 'text')
  assert.equal(smallLaneKind('Rename the local variable usr to user in a.ts'), 'rename')
  assert.equal(smallLaneKind('Remove the unused import in a.ts'), 'imports')
  assert.equal(smallLaneKind('Fix indentation in src/app.js'), 'whitespace')
  assert.equal(smallLaneKind('Bump vitest to 2.1.4 in package.json'), 'bump')
  assert.equal(codeSkeleton('# all text', 'README.md'), '')
})

test('fast lane: a "typo fix" that changes code escalates to the full flow', async t => {
  const directory = repo(t)
  const h = host(t, directory)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  const small = h.tools.get('delivery_small')
  await small.execute({ action: 'start', goal: 'Fix the typo in app.js', files: ['app.js'], checks: [grepCheck('ok', 'export', 'app.js')] }, call)
  writeFileSync(join(directory, 'app.js'), 'export const app = 43\n')
  await assert.rejects(small.execute({ action: 'finish', change: 'Fixed the typo.' }, call), /not a small text edit[\s\S]*app\.js: code changed/)
  await cleanup()
})

test('fast lane: a real comment fix in code passes the content guard', async t => {
  const directory = repo(t)
  writeFileSync(join(directory, 'app.js'), '// Retruns the app\nexport const app = 42\n')
  execFileSync('git', ['commit', '-qam', 'comment'], { cwd: directory })
  const h = host(t, directory)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  const small = h.tools.get('delivery_small')
  await small.execute({ action: 'start', goal: 'Fix the comment typo in app.js', files: ['app.js'], checks: [grepCheck('ok', 'Returns', 'app.js')] }, call)
  writeFileSync(join(directory, 'app.js'), '// Returns the app\nexport const app = 42\n')
  const result = JSON.parse((await small.execute({ action: 'finish', change: 'Fixed the comment typo.' }, call)).content)
  assert.equal(result.status, 'verified')
  await cleanup()
})

test('fast lane: the model cannot open the lane for a request routed to the full flow', async t => {
  const directory = repo(t)
  const h = host(t, directory)
  const cleanup = await registerDelivery(h.ctx, { workflow: 'standard' })
  await h.hooks.get('prompt')({ sessionID: call.sessionID, prompt: { text: 'Fix the typo in app.js so it no longer crashes' } })
  await assert.rejects(h.tools.get('delivery_small').execute({ action: 'start', goal: 'Fix the typo in app.js', files: ['app.js'], checks: [grepCheck('ok', 'export', 'app.js')] }, call), /routed to the full flow \(describes a behaviour change\)/)
  await cleanup()
})
