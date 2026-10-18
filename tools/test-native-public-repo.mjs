#!/usr/bin/env node
/** Offline native delivery against a clean checkout of a pinned public JavaScript repository. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withoutRuntimeGithubToken } from '../lib/environment.mjs';
import { nativeFixture } from './native-fixture.mjs';
import { runNativeEvaluation } from '../lib/opencode/evaluation.mjs';
import { assertNativeShellResult } from './native-public-repo-shell-result.mjs';

const repository = 'https://github.com/jonschlinkert/is-number.git';
const commit = '98e8ff1da1a89f93d1397a24d7413ed15421c139';
const license = 'MIT';
const proofDirectory = process.env.CTG_PUBLIC_REPO_PROOF_DIR;
const childEnv = withoutRuntimeGithubToken(process.env);
let sourceDirectory;
const root = join(import.meta.dirname, '..');
const packageVersion = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const testFile = `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst isNumber = require('./');\ntest('recognizes bigint primitives without changing finite-number behavior', () => {\n  assert.equal(isNumber(42n), true);\n  assert.equal(isNumber(-1n), true);\n  assert.equal(isNumber(1.5), true);\n  assert.equal(isNumber('1.5'), true);\n  assert.equal(isNumber(Infinity), false);\n});\n`;
const host = await nativeFixture({
  plugin: join(root, 'plugins/carthagent'),
  plugins: [join(root, 'lib/opencode/evaluation-budget-plugin')],
  env: { CTG_EVALUATION_MAX_TURNS: '24', CTG_EVALUATION_MAX_COST: '1', CTG_SESSION_OPTIONS: JSON.stringify({ maxTools: 50, maxSeconds: 180, maxRepairs: 12 }) },
  respond(body, res) {
    const messages = body.messages ?? [];
    const tools = (body.tools ?? []).map(tool => tool.function?.name);
    const calls = messages.flatMap(message => message.tool_calls ?? []);
    const results = new Map(messages.filter(message => message.role === 'tool').map(message => [message.tool_call_id, String(message.content)]));
    const completed = calls.filter(call => results.has(call.id)).map(call => ({ ...call, output: results.get(call.id) }));
    const execute = completed.filter(call => call.function?.name === 'execute');
    const code = call => { try { return JSON.parse(call.function.arguments ?? '{}').code ?? ''; } catch { return ''; } };
    const did = name => execute.some(call => code(call).includes(name));
    const dispatch = (name, args) => {
      if (!tools.includes(name)) throw Error(`Required native tool ${name} was not advertised: ${tools.join(', ')}`);
      const call = { index: 0, id: `public-repo-${host.requests.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
      const chunk = (delta, finish_reason = null, usage) => `data: ${JSON.stringify({ id: `public-repo-${host.requests.length}`, object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`${chunk({ role: 'assistant', tool_calls: [call] })}${chunk({}, 'tool_calls', { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 })}data: [DONE]\n\n`);
    };
    const execution = code => dispatch('execute', { code });
    const shells = completed.filter(call => call.function?.name === 'shell');
    const shell = () => {
      const command = shells.length % 2 === 0 ? 'npm test -- --recursive test.js' : `${JSON.stringify(process.execPath)} --test ctg-bigint.test.cjs`;
      dispatch('shell', { command: `${command}; ctg_status=$?; printf '\\nCTG_NATIVE_EXIT_STATUS=%s\\n' "$ctg_status"; exit "$ctg_status"`, workdir: host.cwd });
    };
    if (!completed.length) return execution('const result = await search({query:"CTG delivery plan acceptance checks", namespace:"carthagent", limit:20}); return result');
    if (!did('delivery_plan')) return execution(`const result = await tools.carthagent["delivery_plan"]({goal:"Recognize bigint primitives in the pinned is-number package",verification:"required",assumptions:["Bigint primitives are numeric values and do not require coercion."],artifacts:["."],outputs:["index.js"],steps:[{id:"bigint",title:"Add bigint primitive support",dependsOn:[],checks:["package-tests","bigint-tests"]}],acceptance:[{requirement:"Bigint primitives are recognized while existing finite number and string behavior remains unchanged.",checks:["package-tests","bigint-tests"]}],checks:[{id:"package-tests",kind:"test",argv:["npm","test","--","--recursive","test.js"],timeoutSeconds:60},{id:"bigint-tests",kind:"test",argv:[${JSON.stringify(process.execPath)},"--test","ctg-bigint.test.cjs"],timeoutSeconds:30}]}); return {marker:"PUBLIC_REPO_PLAN",result}`);
    const planResult = completed.find(call => call.function?.name === 'execute' && code(call).includes('delivery_plan'))?.output ?? '';
    if (!tools.includes('shell')) throw Error(`Delivery plan did not unlock shell; plan response: ${planResult}`);
    if (shells.length < 2) return shell();
    if (shells.length === 2) {
      assertNativeShellResult(shells[0].output, { status: 0, passingTests: 111 });
      assertNativeShellResult(shells[1].output, { status: 1 });
      assert.match(shells[1].output, /\b(?:fail|not ok)\s+1\b/i, 'bigint regression must show its expected red assertion');
      if (!completed.some(call => call.function?.name === 'edit')) {
        if (!tools.includes('edit')) throw Error(`Plan did not unlock native edit; advertised: ${tools.join(', ')}`);
        dispatch('edit', { path: join(host.cwd, 'index.js'), oldString: "  if (typeof num === 'number') {\n    return num - num === 0;\n  }", newString: "  if (typeof num === 'bigint') {\n    return true;\n  }\n  if (typeof num === 'number') {\n    return num - num === 0;\n  }" });
        return;
      }
      return shell();
    }
    if (shells.length < 4) return shell();
    assertNativeShellResult(shells[2].output, { status: 0, passingTests: 111 });
    assertNativeShellResult(shells[3].output, { status: 0 });
    assert.match(shells[3].output, /pass\s+1\b/i, 'bigint regression must pass after edit');
    if (!did('delivery_check')) return execution('return await tools.carthagent["delivery_check"]({id:"all"})');
    if (!did('delivery_progress')) return execution('const result = await tools.carthagent["delivery_progress"]({step:"bigint",status:"done",note:"Pinned public package baseline test and bigint regression test pass after the native edit."}); return result');
    const review = [...execute].reverse().find(call => /delivery_review/.test(code(call)) && /inspect/.test(code(call)));
    if (!review) return execution('return await tools.carthagent["delivery_review"]({action:"inspect"})');
    const id = review.output.match(/(?:"captureId"|"id")\s*:\s*"([^"]+)"/)?.[1];
    if (!id) throw Error(`Review capture ID missing in inspect tool output: ${review.output}`);
    if (!completed.some(call => call.function?.name === 'execute' && /delivery_review/.test(code(call)) && /record/.test(code(call)))) {
      return execution(`const result=await tools.carthagent["delivery_review"]({action:"record",captureId:${JSON.stringify(id)},coverage:[{requirement:"Bigint primitives are recognized while existing finite number and string behavior remains unchanged.",assertions:"npm test and node --test ctg-bigint.test.cjs pass in the pinned checkout.",status:"demonstrated"}],probes:["The added test failed on the unmodified public source.","After the native edit, package tests and added regression test pass."],findings:[],limitations:["Offline deterministic provider drives tool calls; no independent code reviewer or public hosting was used.","The task tests an isolated feature addition, not upstream maintainership or a production release."]}); return result`);
    }
    if (!completed.some(call => call.function?.name === 'execute' && /delivery_finish/.test(code(call)) && /Pinned package test suite/.test(code(call)))) return execution('const result=await tools.carthagent["delivery_finish"]({status:"verified",review:"Pinned package test suite and separate declared bigint regression check passed; coverage and probes recorded.",launch:"Not applicable to this library change.",limitations:["Offline deterministic provider; no independent reviewer or public repository write.","One small feature addition in a pinned checkout is not a full migration acceptance claim."]}); return result');
    const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: `public-repo-${host.requests.length}`, object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }], ...(finish_reason ? { usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 } } : {}) })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`${chunk({ role: 'assistant', content: 'Bigint support passed the pinned package tests and declared regression check; handoff recorded.' })}${chunk({}, 'stop')}data: [DONE]\n\n`);
  },
});

try {
  sourceDirectory = join(await mkdtemp(join(tmpdir(), 'ctg-public-repo-source-parent-')), 'checkout');
  await mkdir(sourceDirectory);
  execFileSync('git', ['clone', '--quiet', '--no-checkout', repository, sourceDirectory], { encoding: 'utf8', env: childEnv });
  const git = (...args) => execFileSync('git', args, { cwd: sourceDirectory, encoding: 'utf8', env: childEnv }).trim();
  execFileSync('git', ['checkout', '--quiet', '--detach', commit], { cwd: sourceDirectory, stdio: 'ignore', env: childEnv });
  const sourceCommit = git('rev-parse', 'HEAD');
  assert.equal(sourceCommit, commit, 'fixture must match the pinned upstream source commit');
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=no'), '', 'pinned checkout must have no tracked modifications');
  assert.equal(JSON.parse(await readFile(join(sourceDirectory, 'package.json'), 'utf8')).license, license);
  for (const file of ['index.js', 'package.json', 'LICENSE', 'test.js']) {
    const blob = git('rev-parse', `${commit}:${file}`);
    const copiedHash = execFileSync('git', ['hash-object', join(sourceDirectory, file)], { encoding: 'utf8', env: childEnv }).trim();
    assert.equal(copiedHash, blob, `source file ${file} must match its exact pinned Git blob`);
  }
  // Acquisition is intentionally outside the offline native host/provider run.
  // This historical package has no lockfile; install its declared dev dependencies
  // only, in the fresh pinned clone, without package lifecycle scripts.
  const dependencyInstall = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: sourceDirectory, encoding: 'utf8', env: childEnv });
  assert.equal(dependencyInstall.status, 0, `Pinned checkout dev-dependency install failed: ${dependencyInstall.stdout}\n${dependencyInstall.stderr}`);
  await mkdir(join(host.cwd, 'test'), { recursive: true });
  await cp(join(sourceDirectory, 'node_modules'), join(host.cwd, 'node_modules'), { recursive: true });
  await Promise.all(['index.js', 'package.json', 'LICENSE'].map(file => copyFile(join(sourceDirectory, file), join(host.cwd, file))));
  await copyFile(join(sourceDirectory, 'test.js'), join(host.cwd, 'test.js'));
  await writeFile(join(host.cwd, 'ctg-bigint.test.cjs'), testFile);
  const gitInit = (...args) => execFileSync('git', args, { cwd: host.cwd, stdio: 'ignore', env: childEnv });
  gitInit('init', '--initial-branch=main');
  gitInit('add', 'index.js', 'package.json', 'LICENSE', 'test.js', 'ctg-bigint.test.cjs');
  gitInit('-c', 'user.name=CTG public-repo fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Pinned public repository baseline');
  const runNpmTests = () => spawnSync('npm', ['test', '--', '--recursive', 'test.js'], { cwd: host.cwd, encoding: 'utf8', env: childEnv });
  const runBigintTest = () => spawnSync(process.execPath, ['--test', 'ctg-bigint.test.cjs'], { cwd: host.cwd, encoding: 'utf8', env: childEnv });
  const baselinePackage = runNpmTests();
  assert.equal(baselinePackage.status, 0, `pinned package baseline suite must pass independently: ${baselinePackage.stdout}${baselinePackage.stderr}`);
  assert.match(baselinePackage.stdout, /111 passing/i, 'baseline package suite must run all 111 tests');
  const baselineBigint = runBigintTest();
  assert.notEqual(baselineBigint.status, 0, `regression contract must fail independently on baseline: ${baselineBigint.stdout}${baselineBigint.stderr}`);
  const pinnedTestBytes = await readFile(join(host.cwd, 'test.js'));
  const pinnedIndexBytes = await readFile(join(host.cwd, 'index.js'));
  try {
    await writeFile(join(host.cwd, 'index.js'), pinnedIndexBytes.toString().replace("  if (typeof num === 'number') {", "  if (typeof num === 'bigint') {\n    return true;\n  }\n  if (typeof num === 'number') {"));
    await writeFile(join(host.cwd, 'test.js'), `${pinnedTestBytes}\nit('controlled package-suite failure', function () { assert.equal(true, false); });\n`);
    const negativePackage = runNpmTests();
    const negativeBigint = runBigintTest();
    assert.notEqual(negativePackage.status, 0, `controlled package failure was not detected: ${negativePackage.stdout}${negativePackage.stderr}`);
    assert.equal(negativeBigint.status, 0, `independent bigint check should remain green: ${negativeBigint.stdout}${negativeBigint.stderr}`);
    assert.equal(negativePackage.status === 0 && negativeBigint.status === 0, false, 'green bigint test must not mask failing package suite');
  } finally {
    await writeFile(join(host.cwd, 'index.js'), pinnedIndexBytes);
    await writeFile(join(host.cwd, 'test.js'), pinnedTestBytes);
  }
  await host.active();
  const result = await runNativeEvaluation({
    client: host.client, directory: host.cwd,
    metadata: { 'carthagent.options': { maxTools: 50, maxSeconds: 180, maxRepairs: 12 } },
    prompt: `Complete a small feature task on this real pinned public package checkout, using the registered CTG production delivery tools. Repo=${repository} commit=${commit} license=${license}. First inspect and author a valid delivery plan with distinct checks npm test -- --recursive test.js and ${process.execPath} --test ctg-bigint.test.cjs. Run each separately: establish package suite green and bigint regression red before edit, then make the native edit and require each independently green. Run delivery_check id=all, record progress, inspect and record review coverage/probes honestly, and finish verified. No network access, upstream write, push, or public issue. Do not claim independent review.`,
    provider: host.model.providerID, model: host.model.id, timeoutSeconds: 180, maxTurns: 24, maxCost: 1,
  });
  assert.equal(result.runtime, 'opencode-2');
  assert.equal(result.compatibilityVersion, '2.0.32');
  assert.equal(result.exitCode, 0, JSON.stringify({ result, lastRequests: host.requests.slice(-5).map(request => (request.messages ?? []).slice(-4)) }));
  assert.equal(result.outcome, 'succeeded');
  assert.ok(result.tools.edit >= 1, JSON.stringify(result));
  assert.ok(result.tools.shell >= 2, JSON.stringify(result));
  const finalPackage = runNpmTests();
  assert.equal(finalPackage.status, 0, `package suite independent post-edit run failed: ${finalPackage.stdout}${finalPackage.stderr}`);
  assert.match(finalPackage.stdout, /111 passing/i);
  const finalBigint = runBigintTest();
  assert.equal(finalBigint.status, 0, finalBigint.stdout + finalBigint.stderr);
  assert.match(await readFile(join(host.cwd, 'index.js'), 'utf8'), /typeof num === 'bigint'/);
  const events = [];
  const callNames = new Map();
  const seenCalls = new Set();
  const seenResults = new Set();
  for (const request of host.requests) for (const message of request.messages ?? []) {
    for (const call of message.tool_calls ?? []) {
      if (seenCalls.has(call.id)) continue;
      seenCalls.add(call.id);
      callNames.set(call.id, call.function?.name);
      let args = {};
      try { args = JSON.parse(call.function?.arguments ?? '{}'); } catch {}
      events.push({ kind: 'call', id: call.id, name: call.function?.name, args });
    }
    if (message.role === 'tool' && !seenResults.has(message.tool_call_id)) {
      seenResults.add(message.tool_call_id);
      events.push({ kind: 'result', id: message.tool_call_id, name: callNames.get(message.tool_call_id), output: String(message.content) });
    }
  }
  const shellResults = events.filter(event => event.kind === 'result' && event.name === 'shell');
  assert.equal(shellResults.length, 4, 'native session must separately run package and bigint checks before and after edit');
  assertNativeShellResult(shellResults[0].output, { status: 0, passingTests: 111 });
  assertNativeShellResult(shellResults[1].output, { status: 1 });
  assert.match(shellResults[1].output, /\b(?:fail|not ok)\s+1\b/i, 'bigint regression fails before edit');
  assertNativeShellResult(shellResults[2].output, { status: 0, passingTests: 111 });
  assertNativeShellResult(shellResults[3].output, { status: 0 });
  assert.match(shellResults[3].output, /pass\s+1\b/i, 'bigint regression passes after edit');
  const plan = events.find(event => event.kind === 'result' && event.name === 'execute' && /plan\.d2|Contract accepted/i.test(event.output));
  assert.ok(plan, 'native production delivery plan must have a correlated tool result');
  assert.ok(events.some(event => event.kind === 'result' && event.name === 'edit'), 'native edit must have a correlated result');
  const recordCall = events.find(event => event.kind === 'call' && event.name === 'execute' && /delivery_review/.test(String(event.args.code ?? '')) && /record/.test(String(event.args.code ?? '')));
  assert.ok(recordCall, 'native session must call delivery_review record');
  const recordResult = events.find(event => event.kind === 'result' && event.id === recordCall.id);
  assert.ok(recordResult, 'delivery_review record must have its own correlated result');
  const recordReceipt = JSON.parse(recordResult.output);
  assert.equal(recordReceipt.coverage?.[0]?.status, 'demonstrated', 'delivery_review record itself must retain coverage');
  const finishCall = events.find(event => event.kind === 'call' && event.name === 'execute' && /delivery_finish/.test(String(event.args.code ?? '')));
  assert.ok(finishCall, 'native session must invoke delivery_finish');
  const finishResult = events.find(event => event.kind === 'result' && event.id === finishCall.id);
  assert.ok(finishResult, 'delivery_finish must have its own correlated result');
  let finishPayload;
  try { finishPayload = JSON.parse(finishResult.output); } catch { finishPayload = {}; }
  assert.equal(finishPayload.status, 'verified', 'delivery_finish result itself must be verified');
  const reportPath = finishPayload.report;
  assert.ok(reportPath, 'verified finish output must identify its persisted delivery report');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.handoff?.status, 'verified', 'persisted delivery report handoff must retain verified status');
  let retainedReportPath = null;
  if (proofDirectory) {
    await mkdir(proofDirectory, { recursive: true });
    retainedReportPath = join(proofDirectory, 'delivery-report.json');
    await copyFile(reportPath, retainedReportPath);
  }
  const baselineAt = events.indexOf(shellResults[0]);
  const editAt = events.findIndex(event => event.kind === 'result' && event.name === 'edit');
  const redAt = events.indexOf(shellResults[1]);
  const greenAt = events.indexOf(shellResults[2]);
  assert.ok(baselineAt < redAt && redAt < editAt && editAt < greenAt, 'correlated native chronology is green baseline suite, red regression, edit, then green package suite');
  const correlatedNativeEvidence = events.filter(event => event.kind === 'result' && (event.name === 'shell' || event.name === 'edit' || (event.name === 'execute' && /delivery_(?:plan|check|progress|review|finish)/.test(String(events.find(call => call.kind === 'call' && call.id === event.id)?.args.code ?? '')))));
  let harnessSourceIdentity = { kind: 'installed-package', packageVersion };
  try {
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', env: childEnv }).trim();
    if (/^[a-f0-9]{40,64}$/.test(sourceCommit)) harnessSourceIdentity = { kind: 'git-checkout', commit: sourceCommit };
  } catch { /* Installed package archives do not necessarily include .git. */ }
  console.log(JSON.stringify({ harnessSourceIdentity, harnessSourceSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'), shellResultValidatorSha256: createHash('sha256').update(await readFile(new URL('./native-public-repo-shell-result.mjs', import.meta.url))).digest('hex'), repository, commit, license, sourceBlobs: Object.fromEntries(['index.js', 'package.json', 'LICENSE', 'test.js'].map(file => [file, git('rev-parse', `${commit}:${file}`)])), baseline: '111 package tests passed; declared bigint contract failed', nativeEdit: 'bigint primitive branch added to index.js', postEdit: 'package suite plus bigint regression passed', dependencyInstall: 'npm install --ignore-scripts --no-audit --no-fund from fresh pinned clone; repository has no lockfile', nativeDelivery: 'plan/check/progress/review-record/finish exercised', verifiedFinish: { correlatedCallId: finishCall.id, result: finishPayload, retainedReportPath, persistedHandoffStatus: report.handoff?.status }, outcome: result.outcome, productiveTurns: result.productiveTurns, tools: result.tools, cost: result.cost, runtimeVersion: result.runtimeVersion, runtimeIdentity: host.runtimeIdentity, correlatedNativeEvidence, upstreamWrites: false }));
} catch (error) {
  console.error(JSON.stringify({ providerErrors: host.providerErrors.map(item => item.message), host: host.output }, null, 2));
  throw error;
} finally {
  await host.close();
  if (sourceDirectory) await rm(join(sourceDirectory, '..'), { recursive: true, force: true });
}
