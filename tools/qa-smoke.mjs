#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const CTG = join(ROOT, 'bin', 'ctg.mjs');
const STARTUP_TIMEOUT_MS = 15000;
const COMMAND_TIMEOUT_MS = 120000;
const SAMPLE_PLAN = Object.freeze({
  goal: 'QA smoke fixture',
  artifacts: ['.'],
  steps: ['Run the fixture'],
  acceptance: [{ requirement: 'The fixture prints ok', checks: ['smoke'] }],
  checks: [{ id: 'smoke', kind: 'runtime', argv: ['node', 'app.mjs'], timeoutSeconds: 10 }],
});
const USAGE = `Usage: node tools/qa-smoke.mjs [--json <file>] [--kit <manual-kit-dir>] [--skip-dashboard] [--skip-cli]

Credential-free QA smoke: starts the web dashboard on an ephemeral port and
exercises its HTTP API, then runs offline ctg CLI commands in a disposable
workspace with an isolated HOME. --kit also runs the native TUI offline smoke
(node tools/native-manual.mjs <kit> tiny --smoke) against a kit prepared with
npm run manual:prepare. No model provider, network credential or paid call is used.`;

function isolatedEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, CARTHAGENT_NO_UPDATE_CHECK: '1', ...extra };
  for (const key of Object.keys(env)) if (/_API_KEY$|^CTG_RUNTIME_GITHUB_TOKEN$|^GITHUB_TOKEN$|^GH_TOKEN$/.test(key)) delete env[key];
  return env;
}

export function createWorkspace() {
  const base = mkdtempSync(join(tmpdir(), 'ctg-qa-smoke-'));
  const workspace = join(base, 'workspace');
  const home = join(base, 'home');
  mkdirSync(workspace);
  mkdirSync(home);
  writeFileSync(join(workspace, 'app.mjs'), 'console.log("ok");\n');
  writeFileSync(join(workspace, 'plan.json'), `${JSON.stringify(SAMPLE_PLAN, null, 2)}\n`);
  return { base, workspace, home, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

export async function startDashboard({ workspace, home, token }) {
  const child = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
    cwd: ROOT,
    env: isolatedEnv(home, { CARTHAGENT_WORKSPACE: workspace, CARTHAGENT_PORT: '0', CARTHAGENT_SERVER_TOKEN: token }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const url = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error(`dashboard did not start within ${STARTUP_TIMEOUT_MS} ms:\n${output}`)), STARTUP_TIMEOUT_MS);
    const onData = chunk => {
      output += chunk;
      const match = output.match(/carthagent dashboard: (http:\/\/127\.0\.0\.1:\d+)\//);
      if (match) {
        clearTimeout(timer);
        resolveUrl(match[1]);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`dashboard exited with ${code}:\n${output}`));
    });
  });
  const stop = () =>
    new Promise(resolveStop => {
      if (child.exitCode !== null || child.signalCode !== null) return resolveStop();
      child.once('exit', () => resolveStop());
      child.kill('SIGTERM');
    });
  return { url, stop };
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(url, path, { token, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: { ...(token ? { 'x-carthagent-token': token } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: response.status, type: response.headers.get('content-type') || '', text, json };
}

export function dashboardChecks(context) {
  const api = (path, options = {}) => request(context.url, path, { token: context.token, ...options });
  return [
    [
      'dashboard GET /api/status returns the idle workspace state',
      async () => {
        const res = await api('/api/status');
        expect(res.status === 200, `status ${res.status}: ${res.text.slice(0, 200)}`);
        expect(res.json.workspace === context.workspace, `workspace ${res.json.workspace}`);
        expect(/^[0-9a-f]{64}$/.test(res.json.currentFingerprint), 'currentFingerprint is a SHA-256 digest');
        return `status=${res.json.status} planning.phase=${res.json.planningStatus?.phase}`;
      },
    ],
    [
      'dashboard rejects API calls without the session token',
      async () => {
        const res = await request(context.url, '/api/status');
        expect(res.status === 401 && res.json?.error === 'Unauthorized', `status ${res.status}`);
        return '401 Unauthorized';
      },
    ],
    [
      'dashboard rejects a foreign Origin',
      async () => {
        const res = await api('/api/status', { headers: { origin: 'https://attacker.example' } });
        expect(res.status === 403, `status ${res.status}`);
        return '403 Origin not allowed';
      },
    ],
    [
      'dashboard POST /api/plan/validate accepts the sample plan',
      async () => {
        const res = await api('/api/plan/validate', { method: 'POST', body: { plan: SAMPLE_PLAN } });
        expect(res.status === 200 && res.json?.valid === true, `status ${res.status}: ${res.text.slice(0, 200)}`);
        expect(res.json.d2.includes('direction: down'), 'D2 outline returned');
        return `valid, d2 ${res.json.d2.split('\n').length} lines`;
      },
    ],
    [
      'dashboard POST /api/plan/validate rejects an invalid plan',
      async () => {
        const res = await api('/api/plan/validate', { method: 'POST', body: { plan: { goal: '' } } });
        expect(res.status === 400 && res.json?.valid === false, `status ${res.status}`);
        return `400 ${res.json.error}`;
      },
    ],
    [
      'dashboard POST /api/plan/set persists a plan that /api/status reports',
      async () => {
        const set = await api('/api/plan/set', { method: 'POST', body: { plan: SAMPLE_PLAN } });
        expect(set.status === 200 && set.json?.success, `status ${set.status}: ${set.text.slice(0, 200)}`);
        const status = await api('/api/status');
        expect(status.json.plan?.goal === SAMPLE_PLAN.goal, 'status shows the new plan');
        expect(status.json.pendingChecks.includes('smoke'), 'smoke check is pending');
        return `report ${set.json.report}; status=${status.json.status}; pending=${status.json.pendingChecks.join(',')}`;
      },
    ],
    [
      'dashboard GET /api/docs/readme serves bundled docs',
      async () => {
        const res = await api('/api/docs/readme');
        expect(res.status === 200 && res.json.content.length > 100, `status ${res.status}`);
        return `${res.json.content.length} characters`;
      },
    ],
    [
      'dashboard GET / serves the HTML shell with a content security policy',
      async () => {
        const response = await fetch(`${context.url}/`);
        const html = await response.text();
        expect(response.status === 200 && /<html/i.test(html), `status ${response.status}`);
        expect((response.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"), 'CSP header present');
        return `${html.length} bytes of HTML`;
      },
    ],
  ];
}

export function runCtg(args, { workspace, home }) {
  const result = spawnSync(process.execPath, [CTG, ...args], { cwd: workspace, env: isolatedEnv(home), encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS });
  return { code: result.status, output: `${result.stdout || ''}${result.stderr || ''}`, error: result.error };
}

function cliCheck(name, args, verify) {
  return [
    name,
    async context => {
      const result = runCtg(args, context);
      expect(!result.error, `ctg ${args.join(' ')} failed to run: ${result.error?.message}`);
      return verify(result);
    },
  ];
}

export function cliChecks() {
  return [
    cliCheck('cli ctg --help prints usage', ['--help'], ({ code, output }) => {
      expect(code === 0 && /USAGE:/.test(output), `exit ${code}`);
      return 'exit 0, usage printed';
    }),
    cliCheck('cli ctg demo runs the scripted offline demo', ['demo'], ({ code, output }) => {
      expect(code === 0, `exit ${code}: ${output.slice(-400)}`);
      expect(/Verification: isolated Node test suite passed/.test(output), 'demo verification line');
      return 'exit 0, fixture tests passed';
    }),
    cliCheck('cli ctg status --json reports the workspace', ['status', '--json'], ({ code, output }) => {
      expect(code === 0, `exit ${code}: ${output.slice(-400)}`);
      const status = JSON.parse(output);
      expect(/^[0-9a-f]{64}$/.test(status.currentFingerprint), 'fingerprint');
      return `report=${status.report ? 'present' : 'none'} phase=${status.planningView?.gate?.phase}`;
    }),
    cliCheck('cli ctg hash prints the workspace fingerprint', ['hash'], ({ code, output }) => {
      expect(code === 0 && /^[0-9a-f]{64}$/.test(output.trim()), `exit ${code}: ${output.trim()}`);
      return output.trim();
    }),
    cliCheck('cli ctg validate accepts the sample plan', ['validate', 'plan.json'], ({ code, output }) => {
      expect(code === 0 && /Acceptance contract is VALID/.test(output), `exit ${code}: ${output.slice(0, 300)}`);
      return 'VALID';
    }),
    [
      'cli ctg validate rejects an invalid plan with exit 1',
      async context => {
        writeFileSync(join(context.workspace, 'invalid-plan.json'), '{"goal":""}\n');
        const { code, output } = runCtg(['validate', 'invalid-plan.json'], context);
        expect(code === 1 && /INVALID/.test(output), `exit ${code}`);
        return output.trim().split('\n')[0];
      },
    ],
  ];
}

export function nativeCheck(kit) {
  return [
    'native TUI offline smoke (scripted provider) via tools/native-manual.mjs',
    async context => {
      const result = spawnSync(process.execPath, [join(ROOT, 'tools', 'native-manual.mjs'), resolve(kit), 'tiny', '--smoke'], {
        cwd: ROOT,
        env: isolatedEnv(context.home),
        encoding: 'utf8',
        timeout: 300000,
      });
      const output = `${result.stdout || ''}${result.stderr || ''}`;
      expect(result.status === 0, `exit ${result.status}: ${output.slice(-600)}`);
      const summary = JSON.parse(output.slice(output.indexOf('{')));
      expect(summary.outcome === 'succeeded' && summary.completed === true, `outcome ${summary.outcome}`);
      return `outcome=${summary.outcome} providerRequests=${summary.providerRequests} binary=${summary.binarySha256.slice(0, 12)}`;
    },
  ];
}

export async function runChecks(checks, context, log = () => {}) {
  const results = [];
  for (const [name, run] of checks) {
    const started = Date.now();
    try {
      const evidence = await run(context);
      results.push({ name, passed: true, durationMs: Date.now() - started, evidence });
      log(`PASS ${name} (${Date.now() - started} ms): ${evidence}`);
    } catch (error) {
      results.push({ name, passed: false, durationMs: Date.now() - started, error: error.message });
      log(`FAIL ${name} (${Date.now() - started} ms): ${error.message}`);
    }
  }
  return results;
}

function parseArgs(argv) {
  const options = { json: null, kit: null, dashboard: true, cli: true, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--skip-dashboard') options.dashboard = false;
    else if (arg === '--skip-cli') options.cli = false;
    else if ((arg === '--json' || arg === '--kit') && argv[index + 1]) options[arg.slice(2)] = argv[++index];
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  return options;
}

async function dashboardPhase(context, log) {
  let dashboard;
  try {
    dashboard = await startDashboard(context);
  } catch (error) {
    log(`FAIL dashboard startup: ${error.message}`);
    return [{ name: 'dashboard startup', passed: false, durationMs: 0, error: error.message }];
  }
  log(`dashboard listening at ${dashboard.url}`);
  try {
    return await runChecks(dashboardChecks({ ...context, url: dashboard.url }), context, log);
  } finally {
    await dashboard.stop();
  }
}

export async function main(argv = process.argv.slice(2), log = line => console.log(line)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    log(USAGE);
    return 0;
  }
  const fixture = createWorkspace();
  const context = { ...fixture, token: randomBytes(16).toString('hex') };
  const results = [];
  try {
    if (options.dashboard) results.push(...(await dashboardPhase(context, log)));
    if (options.cli) results.push(...(await runChecks(cliChecks(), context, log)));
    if (options.kit) results.push(...(await runChecks([nativeCheck(options.kit)], context, log)));
  } finally {
    fixture.cleanup();
  }
  const failed = results.filter(result => !result.passed).length;
  log(`${results.length - failed}/${results.length} QA smoke checks passed`);
  if (options.json) {
    mkdirSync(dirname(resolve(options.json)), { recursive: true });
    writeFileSync(
      resolve(options.json),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, results }, null, 2)}\n`,
    );
  }
  return failed || !results.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
