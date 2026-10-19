#!/usr/bin/env node
import { readFile, cp, mkdir, writeFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { nativeFixture, streamText } from './native-fixture.mjs';
import { preflightNativeTestRuntimeArtifact } from './native-runtime-identity.mjs';
import { provisionDefaultNativeTheme } from '../plugins/carthagent/src/ui/theme-provision.mjs';

const root = resolve(import.meta.dirname, '..');

export async function runManualKit(
  directory,
  project = 'tiny',
  { live = false, smoke = false, args = [], stop = false } = {},
) {
  if (!['tiny', 'product', 'scale'].includes(project))
    throw Error('Project must be tiny, product, or scale');
  const kit = resolve(directory);
  const record = JSON.parse(
    await readFile(join(kit, 'manual-kit.json'), 'utf8'),
  );
  const manifestPath = join(root, 'lib/opencode/runtime-release.json');
  const manifestBytes = await readFile(manifestPath);
  const releaseVersion = JSON.parse(manifestBytes).releaseVersion;
  const target = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
  if (
    record.version !== 1 ||
    record.target !== target ||
    record.runtime !== `runtimes/${releaseVersion}/${target}`
  )
    throw Error(
      'Kit platform/layout does not match this machine; prepare a new native kit',
    );
  if (
    createHash('sha256')
      .update(await readFile(manifestPath))
      .digest('hex') !== record.manifestSha256
  )
    throw Error('Kit manifest does not match this source checkout');
  const ownedRoot = join(kit, record.runtime);
  const { identity } = await preflightNativeTestRuntimeArtifact({
    ownedRoot,
    expectedManifestPath: manifestPath,
    env: {},
  });
  if (identity.binarySha256 !== record.binarySha256)
    throw Error('Kit runtime identity changed');
  const safeEnv = Object.fromEntries(
    [
      'PATH',
      'SystemRoot',
      'WINDIR',
      'COMSPEC',
      'PATHEXT',
      'LANG',
      'LC_ALL',
      'TERM',
      'COLORTERM',
    ]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  if (live) {
    if (smoke)
      throw Error('Live mode never runs automatically; use offline --smoke');
    const profile = join(kit, 'profiles', 'live');
    if (stop) {
      const { stopService } = await import('../lib/opencode/service.mjs');
      return await stopService({ root: profile });
    }
    const home = join(profile, 'home');
    await mkdir(home, { recursive: true, mode: 0o700 });
    const env = {
      ...safeEnv,
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(home, 'AppData', 'Local'),
      XDG_CONFIG_HOME: join(profile, 'config'),
      XDG_DATA_HOME: join(profile, 'data'),
      XDG_STATE_HOME: join(profile, 'state'),
      XDG_CACHE_HOME: join(profile, 'cache'),
      CTG_NATIVE: '1',
      CTG_NODE_EXECUTABLE: process.execPath,
      CTG_OWNED_OPENCODE_RUNTIME: ownedRoot,
      CTG_OPENCODE_HOME: profile,
      CARTHAGENT_CONFIG: join(profile, 'carthagent-config.json'),
      CARTHAGENT_CODING_AGENT_DIR: join(profile, 'agent'),
    };
    for (const key of [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'OPENROUTER_API_KEY',
      'GEMINI_API_KEY',
    ])
      if (process.env[key]) env[key] = process.env[key];
    console.log(
      'LIVE mode: prompts/source may leave this machine and provider use may incur charges. Profile:',
      profile,
    );
    const child = spawn(
      process.execPath,
      [join(root, 'bin/ctg.mjs'), ...args],
      { cwd: join(kit, 'projects', project), env, stdio: 'inherit' },
    );
    const [code, signal] = await once(child, 'exit');
    if (signal) throw Error(`Native CLI exited with ${signal}`);
    if (code !== 0) throw Error(`Native CLI exited with status ${code}`);
    return;
  }
  if (stop || args.length)
    throw Error('Extra CLI arguments and --stop require --live');
  const runtimeKeys = [
    'CTG_OWNED_OPENCODE_RUNTIME',
    'CTG_TEST_RUNTIME_RELEASE_MANIFEST',
    'CTG_OPENCODE_BIN',
    'CTG_TEST_RUNTIME_SHA256',
  ];
  const previousEnvironment = Object.fromEntries(
    runtimeKeys.map((key) => [key, process.env[key]]),
  );
  process.env.CTG_OWNED_OPENCODE_RUNTIME = ownedRoot;
  process.env.CTG_TEST_RUNTIME_RELEASE_MANIFEST = manifestPath;
  delete process.env.CTG_OPENCODE_BIN;
  delete process.env.CTG_TEST_RUNTIME_SHA256;
  let host;
  let child;
  try {
    host = await nativeFixture({
      verifyInventory: true,
      env: { CTG_NODE_EXECUTABLE: process.execPath },
      respond(body, res) {
        const messages = body.messages ?? [];
        const latest = [...messages]
          .reverse()
          .find((message) => message.role === 'user');
        const text =
          typeof latest?.content === 'string'
            ? latest.content
            : JSON.stringify(latest?.content ?? '');
        if (text.includes('CTG_MANUAL_INSPECT')) {
          const recent = messages.slice(
            messages.findLastIndex((message) => message.role === 'user'),
          );
          const calls = recent.flatMap((message) => message.tool_calls ?? []);
          const shell = calls.find((call) => call.id === 'manual-inspection');
          const output =
            shell &&
            recent.find(
              (message) =>
                message.role === 'tool' && message.tool_call_id === shell.id,
            );
          if (output)
            return streamText(
              res,
              `CTG_MANUAL_INSPECTION_COMPLETE\n${String(output.content).slice(-4000)}`,
            );
          const planned = calls.some((call) => call.id === 'manual-plan');
          const name = planned ? 'shell' : 'execute';
          if (!(body.tools ?? []).some((tool) => tool.function?.name === name))
            return streamText(
              res,
              `CTG_MANUAL_POLICY_REJECTED: ${name} is not admitted. ${recent
                .filter((message) => message.role === 'tool')
                .map((message) => String(message.content))
                .join('\n')}`,
            );
          const input = planned
            ? {
                command: `node --input-type=module -e "import {spawnSync} from 'node:child_process';const r=spawnSync(process.execPath,['--test','--test-reporter=tap','test/*.test.mjs'],{encoding:'utf8',maxBuffer:16000000});console.log(r.status===0?(r.stdout??'').split(String.fromCharCode(10)).filter(s=>s.startsWith('# ')).slice(-8).join(String.fromCharCode(10)):(r.stdout??'').slice(-12000));process.stderr.write(r.stderr??'');console.log('CTG_MANUAL_BASELINE_EXIT='+r.status);process.exit(r.status??1)"`,
                workdir: host.cwd,
              }
            : {
                code: `return await tools.carthagent["delivery_plan"](${JSON.stringify({ goal: 'Observe the generated project baseline without modifying source', assumptions: ['This is a scripted offline inspection, not implementation or independent review.'], artifacts: ['test', 'TASK.md', 'package.json'], outputs: ['Baseline test results'], steps: [{ id: 'inspect', title: 'Run the existing baseline', checks: ['baseline'] }], acceptance: [{ requirement: 'Existing baseline tests pass', checks: ['baseline'] }], checks: [{ id: 'baseline', kind: 'test', argv: [process.execPath, '--test', 'test/*.test.mjs'], timeoutSeconds: 30 }] })})`,
              };
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          const call = {
            index: 0,
            id: planned ? 'manual-inspection' : 'manual-plan',
            type: 'function',
            function: { name, arguments: JSON.stringify(input) },
          };
          res.end(
            `data: ${JSON.stringify({ id: 'manual', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [call] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
          );
          return;
        }
        streamText(
          res,
          `CTG_MANUAL_REPLY\nLocal fixture response; this is not a reasoning model.\n${text.slice(-600)}\nUnicode payload: café Ελληνικά 日本語 🧪\nType CTG_MANUAL_INSPECT to run this project's baseline through a real native shell tool.`,
        );
      },
    });
    await cp(join(kit, 'projects', project), host.cwd, {
      recursive: true,
      filter: (source) =>
        !source
          .split(/[\\/]/)
          .some((part) =>
            ['.git', '.harness', 'node_modules', '.env'].includes(part),
          ),
    });
    execFileSync('git', ['init', '-b', 'main'], {
      cwd: host.cwd,
      env: safeEnv,
      stdio: 'pipe',
    });
    const session = await host.client.session.create(
      {
        location: host.location,
        model: host.model,
        title: `Manual ${project} fixture`,
        metadata: {
          'ctg.raw': true,
          'carthagent.options': { guide: false, strict: false, review: 'no' },
        },
      },
      host.request(),
    );
    await host.active();
    await provisionDefaultNativeTheme(join(host.temp, 'config/opencode'));
    const env = {
      ...safeEnv,
      HOME: join(host.temp, 'home'),
      USERPROFILE: join(host.temp, 'home'),
      XDG_CONFIG_HOME: join(host.temp, 'config'),
      XDG_DATA_HOME: join(host.temp, 'data'),
      XDG_STATE_HOME: join(host.temp, 'state'),
      XDG_CACHE_HOME: join(host.temp, 'cache'),
      OPENCODE_CONFIG_DIR: join(host.temp, 'config/opencode'),
      OPENCODE_CONFIG_PROJECT_DISABLE: 'true',
      OPENCODE_PASSWORD: host.password,
      CTG_NODE_EXECUTABLE: process.execPath,
    };
    if (smoke) {
      await host.client.session.prompt(
        { sessionID: session.id, text: 'CTG_MANUAL_INSPECT' },
        host.request(),
      );
      const outcome = await host.outcome(session.id);
      if (outcome !== 'succeeded')
        throw Error(`Native inspection ended with ${outcome}`);
      const messages = await host.client.session.context(
        { sessionID: session.id },
        host.request(),
      );
      const rendered = JSON.stringify(messages);
      if (
        !rendered.includes('CTG_MANUAL_INSPECTION_COMPLETE') ||
        !rendered.includes('CTG_MANUAL_BASELINE_EXIT=0')
      )
        throw Error(
          'Native project inspection did not finish with a successful correlated baseline tool result',
        );
      const report = {
        project,
        binarySha256: record.binarySha256,
        scope:
          'Scripted offline provider; actual native plugin, shell and generated-project baseline',
        outcome,
        providerRequests: host.requests.length,
        completed: true,
      };
      await mkdir(join(kit, 'reports'), { recursive: true });
      await writeFile(
        join(kit, 'reports', `${project}-native-smoke.json`),
        JSON.stringify(report, null, 2) + '\n',
      );
      console.log(JSON.stringify(report, null, 2));
      return report;
    }
    console.log(
      `OFFLINE UI: disposable ${project} copy; no provider keys forwarded. This is not an OS sandbox.\nProfile disappears on exit. Do not use this mode to judge model quality.\nUse CTG_MANUAL_INSPECT, /help, /clear, /autocompact off, /workflow.\nProject: ${host.cwd}`,
    );
    child = spawn(
      identity.binary,
      ['--server', host.baseUrl, '--session', session.id],
      { cwd: host.cwd, env, stdio: 'inherit' },
    );
    const [code, signal] = await once(child, 'exit');
    if (signal) throw Error(`Native TUI exited with ${signal}`);
    if (code !== 0) throw Error(`Native TUI exited with status ${code}`);
  } catch (error) {
    if (host)
      console.error(
        'Offline fixture diagnostics:',
        JSON.stringify({
          providerErrors: host.providerErrors.map((error) => error.message),
          requests: host.requests.length,
          tools: host.requests
            .at(-1)
            ?.tools?.map((tool) => tool.function?.name),
          lastToolResults: host.requests
            .at(-1)
            ?.messages?.filter((message) => message.role === 'tool')
            .map((message) => String(message.content).slice(-2500)),
        }),
      );
    throw error;
  } finally {
    if (child && child.exitCode === null && child.signalCode === null)
      child.kill('SIGTERM');
    try {
      await host?.close();
    } finally {
      for (const key of runtimeKeys) {
        if (previousEnvironment[key] === undefined) delete process.env[key];
        else process.env[key] = previousEnvironment[key];
      }
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [directory, project = 'tiny', ...options] = process.argv.slice(2);
  if (!directory)
    throw Error(
      'Usage: node tools/native-manual.mjs <kit> [tiny|product|scale] [--smoke | --live [-- <ctg arguments>]]',
    );
  const delimiter = options.indexOf('--');
  const flags = delimiter < 0 ? options : options.slice(0, delimiter);
  if (flags.some((flag) => !['--live', '--smoke', '--stop'].includes(flag)))
    throw Error('Unknown manual runner option');
  await runManualKit(directory, project, {
    live: flags.includes('--live'),
    smoke: flags.includes('--smoke'),
    stop: flags.includes('--stop'),
    args: delimiter < 0 ? [] : options.slice(delimiter + 1),
  });
}
