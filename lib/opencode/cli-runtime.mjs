import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fingerprint, completionIssues, evidenceFresh, validatePlan, planD2, runCommand } from '../delivery.mjs';
import { lockWorkspace, selectReport } from '../workspace.mjs';
import { latestReport, saveReport } from '../reports.mjs';
import { startImplementation } from '../planning.mjs';
import { planningView } from '../planning-view.mjs';
import { validateBudgetOptions } from '../budget.mjs';
import { loadRequiredChecks } from '../delivery.mjs';
import { normalizeReviewMode, resolveReviewMode, loadCarthagentConfig, saveCarthagentConfig, carthagentConfigPath } from '../review.mjs';

const HERE = new URL('.', import.meta.url);
const ROOT = resolve(fileURLToPath(new URL('../..', HERE)));
let rpcDefinitions;

async function nativeRpcDefinitions() {
  rpcDefinitions ??= (async () => {
    const { createJiti } = await import('jiti');
    const loader = createJiti(import.meta.url);
    const [carthagent, archive, sessionControls] = await Promise.all([
      loader.import('../../plugins/carthagent/src/rpc.ts'),
      loader.import('../../plugins/carthagent/src/archive-rpc.ts'),
      loader.import('../../plugins/carthagent/src/session-rpc.ts'),
    ]);
    return { Carthagent: carthagent.Carthagent, Archive: archive.Archive, SessionControls: sessionControls.SessionControls };
  })();
  return rpcDefinitions;
}

async function nativeModules() {
  const runtimeRoot = process.env.CTG_NATIVE_RUNTIME_ROOT || ROOT;
  const load = (file) => import(pathToFileURL(join(runtimeRoot, 'lib/opencode', file)).href);
  const [runtime, service, headless] = await Promise.all([
    load('runtime.mjs'), load('service.mjs'), load('headless.mjs'),
  ]);
  return { runtime, service, headless, runtimeRoot, packageRoot: ROOT };
}

function providerModel(options) {
  if (!options.model) return undefined;
  const full = options.model;
  const split = full.indexOf('/');
  const providerID = options.provider || (split > 0 ? full.slice(0, split) : undefined);
  const modelID = split > 0 && !options.provider ? full.slice(split + 1) : full;
  return { ...(providerID ? { providerID } : {}), id: modelID };
}

function textParts(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const lastUser = list.findLastIndex(message => message?.type === 'user' || message?.info?.role === 'user' || message?.role === 'user');
  const currentTurn = lastUser >= 0 ? list.slice(lastUser + 1) : list;
  const assistants = currentTurn.filter(message => message?.type === 'assistant' || message?.info?.role === 'assistant' || message?.role === 'assistant');
  const completed = assistants.findLast(message => (message?.finish ?? message?.info?.finish ?? message?.info?.status ?? message?.status) === 'stop');
  const selected = completed ? [completed] : assistants;
  const output = [];
  for (const message of selected) {
    const parts = message?.parts ?? message?.content ?? message?.info?.parts ?? [];
    for (const part of Array.isArray(parts) ? parts : []) {
      if (typeof part === 'string') output.push(part);
      else if (part?.type === 'text' && typeof part.text === 'string') output.push(part.text);
    }
  }
  return output;
}

function headlessSucceeded(result) {
  const messages = Array.isArray(result?.messages) ? result.messages : result?.messages?.data ?? result?.messages?.messages ?? [];
  const terminal = [...messages].reverse().find(message => message?.type === 'idle');
  const assistant = [...messages].reverse().find(message => message?.type === 'assistant' || message?.info?.role === 'assistant' || message?.role === 'assistant');
  const outcome = result?.terminal === true ? result.outcome : result?.session?.outcome ?? terminal?.outcome;
  const finish = assistant?.finish ?? assistant?.info?.finish ?? assistant?.info?.status ?? assistant?.status;
  const error = assistant?.error ?? assistant?.info?.error;
  return outcome === 'succeeded' && finish === 'stop' && !error && result?.terminal !== false;
}

function hasHeadlessTerminal(result) {
  if (result?.terminal === true && ['succeeded', 'failed', 'interrupted', 'timed-out'].includes(result?.outcome)) return true;
  if (result?.terminal === false) return false;
  if (result?.outcome && ['failed', 'interrupted', 'timed-out'].includes(result.outcome)) return true;
  const messages = Array.isArray(result?.messages) ? result.messages : result?.messages?.data ?? result?.messages?.messages ?? [];
  return typeof result?.session?.outcome === 'string'
    || [...messages].reverse().some(message => message?.type === 'idle' && typeof message.outcome === 'string');
}

function nativeJsonEvents(events, sessionID, messages, terminalState = {}) {
  const selected = events.filter(event => sessionID && event?.data?.sessionID === sessionID);
  const output = [];
  const seen = new Set();
  const emit = event => {
    const key = event.id || JSON.stringify(event);
    if (seen.has(key)) return;
    seen.add(key);
    output.push(event);
  };
  const ordered = [...selected].sort((left, right) => Number(left.created || 0) - Number(right.created || 0));
  const toolNames = new Map();
  const toolInputs = new Map();
  for (const event of ordered) {
    const data = event.data || {};
    if (event.type === 'session.tool.input.started') {
      toolNames.set(data.id, data.name || 'tool');
    } else if (event.type === 'session.tool.input.ended') {
      let input = {};
      try { input = JSON.parse(data.text); } catch { input = { raw: data.text }; }
      toolInputs.set(data.id, input);
    } else if (event.type === 'session.tool.called') {
      emit({ type: 'tool_execution_start', sessionID, toolCallId: data.id, toolName: toolNames.get(data.id) || data.input?.name || data.name || 'tool', args: toolInputs.get(data.id) ?? data.input?.arguments ?? data.input ?? {} });
    } else if (event.type === 'session.tool.success') {
      emit({ type: 'tool_execution_end', sessionID, toolCallId: data.id, toolName: toolNames.get(data.id) || data.metadata?.title || data.metadata?.name || 'tool', isError: false, result: { content: data.content || [] } });
    } else if (event.type === 'session.tool.failed') {
      emit({ type: 'tool_execution_end', sessionID, toolCallId: data.id, toolName: toolNames.get(data.id) || data.metadata?.title || data.metadata?.name || 'tool', isError: true, result: { content: data.content || [{ type: 'text', text: data.error?.message || 'Tool failed' }] } });
    }
  }
  const lastUserIndex = messages.findLastIndex(message => message?.role === 'user' || message?.info?.role === 'user' || message?.type === 'user');
  const assistants = messages.slice(lastUserIndex < 0 ? 0 : lastUserIndex + 1)
    .filter(message => message?.role === 'assistant' || message?.info?.role === 'assistant' || message?.type === 'assistant');
  const finalAssistant = assistants.findLast(message => {
    const finish = message.finish ?? message.info?.finish ?? message.info?.status ?? message.status;
    return finish && finish !== 'tool-calls';
  });
  if (finalAssistant) {
    const finish = finalAssistant.finish ?? finalAssistant.info?.finish ?? finalAssistant.info?.status ?? finalAssistant.status;
    const content = finalAssistant.parts || finalAssistant.content || finalAssistant.info?.parts || [];
    const error = finalAssistant.error ?? finalAssistant.info?.error ?? finalAssistant.errorMessage;
    emit({ type: 'message_end', sessionID, message: {
      role: 'assistant', content,
      stopReason: finish === 'stop' ? 'stop' : finish,
      ...(error ? { error } : {}),
    } });
    if (finish === 'error') emit({ type: 'message', sessionID, message: finalAssistant });
  }
  const idle = messages.findLast(message => message?.type === 'idle' && typeof message.outcome === 'string');
  if (idle) emit({ type: 'message', sessionID, message: idle });
  else {
    const terminal = ordered.findLast(event => event.type === 'session.execution.failed' || event.type === 'session.execution.interrupted' || event.type === 'session.execution.succeeded');
    if (terminal) {
      const outcome = terminal.type === 'session.execution.failed' ? 'failed'
        : terminal.type === 'session.execution.interrupted' ? 'interrupted' : 'succeeded';
      emit({ type: 'message', sessionID, message: { type: 'idle', outcome, ...(terminal.data?.error ? { error: terminal.data.error } : {}) } });
    } else if (['failed', 'interrupted', 'succeeded', 'timed-out'].includes(terminalState.outcome)) {
      emit({ type: 'message', sessionID, message: { type: 'idle', outcome: terminalState.outcome, ...(terminalState.error ? { error: terminalState.error } : {}) } });
    }
  }
  if (!sessionID && ['failed', 'interrupted', 'succeeded', 'timed-out'].includes(terminalState.outcome)) {
    emit({ type: 'message', message: { type: 'idle', outcome: terminalState.outcome, ...(terminalState.error ? { error: terminalState.error } : {}) } });
  }
  return output;
}

async function latestSessionForWorkspace(client, cwd) {
  const response = await client.session.list({ directory: cwd });
  const sessions = Array.isArray(response?.data) ? response.data : [];
  return sessions
    .filter(session => session.location?.directory === cwd || session.directory === cwd)
    .sort((left, right) => Number(right.time?.updated || right.time?.created || 0) - Number(left.time?.updated || left.time?.created || 0))[0]?.id;
}

function modelWithThinking(model, thinking) {
  if (!model || !thinking) return model;
  return { ...model, variant: thinking };
}

function acceptedTurn(messages, accepted) {
  const list = Array.isArray(messages) ? messages : messages?.data ?? messages?.messages ?? [];
  if (!list.length) return [];
  const acceptedIndex = accepted?.id ? list.findIndex(message => (message?.id ?? message?.info?.id) === accepted.id) : -1;
  // With a runtime-provided admission marker, a projection that does not
  // contain that exact message is not evidence for this turn. Falling back to
  // the latest user in session history could surface a prior successful turn.
  if (accepted?.id && acceptedIndex < 0) return [];
  const lastUser = list.findLastIndex(message => message?.type === 'user' || message?.info?.role === 'user' || message?.role === 'user');
  const start = acceptedIndex >= 0 ? acceptedIndex : lastUser;
  return start >= 0 ? list.slice(start).slice(-200) : list.slice(-200);
}

async function reconcileHeadlessResult(result, { client, timeoutMs = 5000, signal }) {
  const originalMessages = acceptedTurn(result?.messages, result?.accepted);
  // Never reconcile against old history when the current call did not reach a
  // terminal outcome. If admission succeeded, however, its captured current-
  // turn messages and session identity remain valid for output projection.
  if (result?.terminal === false) return { ...result, messages: originalMessages };
  const authoritativeOutcome = result?.outcome ?? result?.session?.outcome;
  const explicitTerminal = result?.terminal === true
    || result?.terminal !== false && ['succeeded', 'failed', 'interrupted', 'timed-out'].includes(authoritativeOutcome);
  if (explicitTerminal) {
    const terminal = result?.terminal === true;
    return { ...result, messages: originalMessages, outcome: authoritativeOutcome, terminal };
  }
  const sessionID = result?.session?.id;
  if (!sessionID || signal?.aborted || timeoutMs <= 0) return { ...result, messages: originalMessages };
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('Headless result reconciliation timed out.')), Math.max(1, timeoutMs));
  let messages = originalMessages;
  try {
    while (!controller.signal.aborted && Date.now() < deadline) {
      const request = async fn => {
        if (controller.signal.aborted) throw controller.signal.reason;
        let abortListener;
        const aborted = new Promise((_, reject) => {
          abortListener = () => reject(controller.signal.reason || new Error('Headless result reconciliation aborted.'));
          controller.signal.addEventListener('abort', abortListener, { once: true });
        });
        try { return await Promise.race([fn({ signal: controller.signal }), aborted]); }
        finally { controller.signal.removeEventListener('abort', abortListener); }
      };
      const context = await request(options => client.session.context({ sessionID }, options));
      const projected = acceptedTurn(context?.data ?? context, result?.accepted);
      if (projected.length) messages = projected;
      const current = { ...result, messages };
      if ((result?.accepted && hasHeadlessTerminal(current)) || Date.now() >= deadline) break;
      await new Promise(resolveWait => {
        const delay = setTimeout(done, Math.min(25, Math.max(1, deadline - Date.now())));
        function done() { controller.signal.removeEventListener('abort', stopped); resolveWait(); }
        function stopped() { clearTimeout(delay); controller.signal.removeEventListener('abort', stopped); resolveWait(); }
        controller.signal.addEventListener('abort', stopped, { once: true });
      });
    }
  } catch {
    // Reconciliation is best-effort only. Preserve the current-turn result from
    // runHeadless; never replace it with stale or partial session history.
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
  const terminalFromProjection = messages.findLast(message => message?.type === 'idle' && ['succeeded', 'failed', 'interrupted'].includes(message.outcome));
  return {
    ...result,
    messages,
    // Only trust a projected terminal when the current accepted turn is
    // explicitly bounded and no authoritative runHeadless outcome exists.
    ...(!result?.terminal && !authoritativeOutcome && terminalFromProjection && result?.accepted ? { outcome: terminalFromProjection.outcome, terminal: true } : {}),
  };
}

function formFieldActive(field, answer) {
  return !Array.isArray(field.when) || field.when.every(condition => condition.op === 'neq' ? answer[condition.key] !== condition.value : answer[condition.key] === condition.value);
}

function normalizeFormValue(field, value) {
  if (field.type === 'boolean') return typeof value === 'boolean' ? value : String(value).toLowerCase() === 'true';
  if (field.type === 'integer') {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error(`${field.title || field.key} must be an integer.`);
    if (field.minimum != null && number < Number(field.minimum) || field.maximum != null && number > Number(field.maximum)) throw new Error(`${field.title || field.key} must be between ${field.minimum} and ${field.maximum}.`);
    return number;
  }
  if (field.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${field.title || field.key} must be a number.`);
    if (field.minimum != null && number < Number(field.minimum) || field.maximum != null && number > Number(field.maximum)) throw new Error(`${field.title || field.key} must be between ${field.minimum} and ${field.maximum}.`);
    return number;
  }
  if (field.type === 'multiselect') {
    const values = Array.isArray(value) ? value : String(value).split(',').map(item => item.trim()).filter(Boolean);
    if (field.minItems != null && values.length < field.minItems || field.maxItems != null && values.length > field.maxItems) throw new Error(`${field.title || field.key} must contain ${field.minItems ?? 0} to ${field.maxItems ?? 'any'} selections.`);
    const options = new Set((field.options || []).map(option => option.value));
    if (!field.custom && values.some(item => !options.has(item))) throw new Error(`${field.title || field.key} contains an unsupported selection.`);
    return values;
  }
  if (field.type === 'string') {
    const text = String(value);
    if (field.minLength != null && text.length < field.minLength || field.maxLength != null && text.length > field.maxLength) throw new Error(`${field.title || field.key} must contain ${field.minLength ?? 0} to ${field.maxLength ?? 'any'} characters.`);
    if (field.pattern && !new RegExp(field.pattern).test(text)) throw new Error(`${field.title || field.key} has an invalid format.`);
    if (field.options?.length && !field.custom && !field.options.some(option => option.value === text)) throw new Error(`${field.title || field.key} must match one of the listed options.`);
    return text;
  }
  if (field.type === 'external') throw new Error(`External authentication field ${field.key} cannot be answered by the native CLI.`);
  return value;
}

function shipLoginGuidance(error) {
  const message = String(error?.data?.message || error?.message || '');
  const type = String(error?.type || error?.data?.type || '');
  if (type === 'ship.unauthenticated' || type === 'ship.not-connected') {
    return 'Carthagent Ship is not connected. Run `ctg login` and choose Carthagent Ship, then retry.';
  }
  if (/active Carthagent Ship OAuth connection is required|not authenticated|unauthorized/i.test(message)) {
    return 'Carthagent Ship is not connected. Run `ctg login` and choose Carthagent Ship, then retry.';
  }
}

function questionWithAbort(prompt, text, signal) {
  signal?.throwIfAborted();
  return new Promise((resolveQuestion, rejectQuestion) => {
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      prompt.close();
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => finish(rejectQuestion, signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(() => prompt.question(text)).then(
      value => finish(resolveQuestion, value),
      error => finish(rejectQuestion, error),
    );
    if (signal?.aborted) onAbort();
  });
}

async function questionMasked(stdin, stdout, label, signal) {
  if (!stdin?.isTTY || !stdout?.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error(`Cannot securely prompt for ${label}: a raw interactive terminal is required.`);
  }
  stdout.write(`${label}: `);
  const wasRaw = Boolean(stdin.isRaw);
  stdin.setRawMode(true);
  stdin.resume?.();
  return new Promise((resolveQuestion, rejectQuestion) => {
    const value = [];
    let settled = false;
    let cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw);
      stdout.write('\n');
    };
    const finish = (callback, result) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      cleanup();
      callback(result);
    };
    const onData = chunk => {
      for (const char of String(chunk)) {
        if (char === '\u0003') { process.emit('SIGINT'); return; }
        if (char === '\r' || char === '\n') { finish(resolveQuestion, value.join('')); return; }
        if (char === '\u007f' || char === '\b') { if (value.length) { value.pop(); stdout.write('\b \b'); } continue; }
        if (char >= ' ') { value.push(char); stdout.write('*'); }
      }
    };
    const onAbort = () => finish(rejectQuestion, signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    stdin.on('data', onData);
    if (signal?.aborted) onAbort();
  });
}

async function sessionOptionsMetadata(options, cwd, runtimeRoot = ROOT) {
  const { sessionOptionsMetadata: serialize } = await import(pathToFileURL(join(runtimeRoot, 'lib/opencode/session-options.mjs')).href);
  return serialize(options, cwd);
}

async function persistSessionOptions(client, sessionID, metadata, options, { signal, directory } = {}) {
  if (!sessionID || !Object.keys(options).length) return metadata;
  const session = await client.session.get({ sessionID }, signal ? { signal } : undefined);
  const sessionDirectory = session?.location?.directory || session?.directory;
  if (sessionDirectory !== directory) throw new Error('Cannot apply Carthagent launch options to a session from another workspace.');
  const previous = session?.metadata?.['carthagent.options'];
  const mergedOptions = { ...(previous && typeof previous === 'object' ? previous : {}), ...options };
  const mergedMetadata = { ...(session?.metadata || {}), ...metadata, 'carthagent.options': mergedOptions };
  if (typeof client.session.update !== 'function') throw new Error('Native OpenCode client cannot persist per-session Carthagent options for a resumed session.');
  await client.session.update({ sessionID, metadata: mergedMetadata }, signal ? { signal } : undefined);
  return mergedMetadata;
}

async function loadPromptContext(options, cwd) {
  let prompt = options.prompt || '';
  if (options.context) {
    const extra = await readFile(resolve(cwd, options.context), 'utf8');
    prompt = `${prompt}\n\nAdditional task context (from ${resolve(cwd, options.context)}):\n${extra}`;
  }
  if (options.validators) {
    const manifest = resolve(cwd, options.validators);
    const content = JSON.parse(await readFile(manifest, 'utf8'));
    if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error(`Invalid validator manifest: ${manifest}`);
    prompt = `${prompt}\n\nRequired validator manifest: ${manifest}\n${JSON.stringify(content, null, 2)}\nThe required validators are user-owned and must not be omitted or weakened.`;
  }
  return prompt;
}

function installSignalHandlers() {
  const controller = new AbortController();
  const abort = () => controller.abort(Object.assign(new Error('Interrupted'), { name: 'AbortError', code: 'SIGINT' }));
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  return { controller, dispose: () => { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); } };
}

function childExit(child) {
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
}

function modelRows(data) {
  const models = Array.isArray(data?.data) ? data.data : Array.isArray(data?.all) ? data.all : [];
  return models.map(model => ({ ...model, providerName: model.providerID || model.provider || 'Unknown' }));
}

export async function createOpenCodeCliRuntime({ cwd = process.cwd(), io = console, stdout = process.stdout, stdin = process.stdin, native = {}, readlineFactory = createInterface, openBrowserImpl = async url => (await import('../cloud/client.mjs')).openBrowser(url) } = {}) {
  const modules = native.runtime && native.service && native.headless ? native : await nativeModules();
  const { runtime, service: serviceApi, headless: headlessApi } = modules;
  const runtimeRoot = modules.runtimeRoot || ROOT;
  const makeClient = native.clientFactory || (async service => {
    const { OpenCode } = await import('@opencode/client');
    return OpenCode.make({ baseUrl: service.url, headers: service.headers });
  });
  const pluginPath = join(runtimeRoot, 'plugins/carthagent');
  const { shipAgentDir } = await import('../ship-auth.mjs');
  const runtimeOptions = {
    pluginPath,
    env: { CTG_NATIVE_ARCHIVE_ROOTS: JSON.stringify([join(shipAgentDir(process.env), 'sessions')]) },
    ...(process.env.CTG_OPENCODE_HOME ? { root: process.env.CTG_OPENCODE_HOME } : {}),
  };
  const ensure = (options = {}) => serviceApi.ensureService({ ...runtimeOptions, ...options });
  const serviceClient = async (options = {}) => {
    const service = await ensure(options);
    return { service, client: await makeClient(service, cwd, runtimeRoot), cwd, runtimeRoot };
  };

  async function run({ mode, options, prompt }) {
    if (options.demo) {
      if (mode !== 'interactive') throw new Error('The offline native demo requires an interactive terminal.');
      const { runOfflineDemo } = await import('./demo.mjs');
      return runOfflineDemo({ io, nodeBinary: process.env.CTG_NODE_EXECUTABLE || process.execPath, ...(native.demoExecute ? { execute: native.demoExecute } : {}) });
    }
    const sticky = (await import('../review.mjs')).resolveStickyDefaults(options);
    options.theme ??= sticky.theme;
    options.model ??= sticky.model;
    const glyphMode = options.ascii ? 'ascii' : options.glyphs;
    if (glyphMode && !['auto', 'ascii', 'unicode'].includes(glyphMode)) throw new Error('--glyphs must be auto, ascii, or unicode.');
    let resolvedGlyphs;
    if (mode === 'interactive') {
      const { detectGlyphMode } = await import('../tui/glyphs.mjs');
      const glyphEnvironment = runtime.runtimeEnvironment ? runtime.runtimeEnvironment() : process.env;
      resolvedGlyphs = glyphMode === 'ascii' || glyphMode === 'unicode' ? glyphMode : detectGlyphMode(glyphEnvironment);
    }
    validateBudgetOptions(options, { allowWithoutDelivery: true });
    for (const [key, max] of [['maxTools', 1_000_000], ['maxSeconds', 1_000_000], ['maxRepairs', 1_000_000]]) {
      if (options[key] !== undefined && (!/^\d+$/.test(String(options[key])) || Number(options[key]) > max)) {
        throw new Error(`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)} must be an integer from 0 to ${max}`);
      }
    }
    if (options.bashCap !== undefined && (!/^\d+(?:\.\d+)?$/.test(String(options.bashCap)) || Number(options.bashCap) <= 0)) {
      throw new Error('--bash-cap must be a positive number of seconds');
    }
    if (options.delivery === false && options.strict === false) throw new Error('--no-delivery and --no-strict cannot be combined; select one workflow mode.');
    const sessionSettings = {
      ...(options.strict === undefined ? {} : { strict: options.strict }),
      ...(options.delivery === undefined ? {} : { delivery: options.delivery }),
      ...(options.autoFraming === undefined ? {} : { guide: options.autoFraming }),
      ...((options.workflow || options.strict !== undefined) ? { workflow: options.workflow || (options.strict ? 'strict' : 'standard') } : {}),
      ...(options.maxTools !== undefined ? { maxTools: options.maxTools } : {}),
      ...(options.maxSeconds !== undefined ? { maxSeconds: options.maxSeconds } : {}),
      ...(options.maxRepairs !== undefined ? { maxRepairs: options.maxRepairs } : {}),
      ...(options.bashCap !== undefined ? { bashCap: options.bashCap } : {}),
      ...(options.validators ? { validators: resolve(cwd, options.validators) } : {}),
      ...(options.context ? { context: options.context } : {}),
      ...(options.review ? { review: options.review } : {}),
      ...(options.codegraphMaxFiles !== undefined ? { codegraphMaxFiles: options.codegraphMaxFiles } : {}),
    };
    const metadata = await sessionOptionsMetadata(sessionSettings, cwd, runtimeRoot);
    const workspaceEnv = runtime.workspaceEnvironment
      ? runtime.workspaceEnvironment(cwd)
      : { ...process.env, CTG_WORKSPACE: cwd };
    const promptText = await loadPromptContext(options, cwd);
    const { shouldFrame, framePrompt } = await import('../tui/framing.mjs');
    const framedPrompt = shouldFrame(promptText, { enabled: options.autoFraming !== false, delivery: options.delivery !== false })
      ? framePrompt(promptText) : promptText;
      const isolatedRoot = options.isolate
        ? join(runtime.runtimePaths?.(runtimeOptions).root ?? process.env.CTG_OPENCODE_HOME ?? join(homedir(), '.carthagent', 'opencode'), 'isolated', randomUUID())
        : undefined;
      let ownedIsolatedService = false;
      let isolatedEnsureAttempted = false;
      let service;
      const model = modelWithThinking(providerModel(options), options.thinking);
      const signal = installSignalHandlers();
      let eventController;
      let eventReader = Promise.resolve();
      try {
        isolatedEnsureAttempted = Boolean(isolatedRoot);
        service = await ensure({
          ...(options.engineCli ? { binary: options.engineCli } : {}),
          ...(isolatedRoot ? { root: isolatedRoot, pluginPath, isolate: true } : {}),
          ...(isolatedRoot ? { profile: { project: false, global: false, claude: false, skills: [], instructions: [], commands: {}, agents: {} } } : {}),
        });
        ownedIsolatedService = Boolean(isolatedRoot && service.paths?.root === isolatedRoot);
        const sessionEnv = { ...workspaceEnv, ...(isolatedRoot ? { OPENCODE_CONFIG_PROJECT_DISABLE: 'true', OPENCODE_DISABLE_CLAUDE_CODE: 'true', OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: 'true' } : {}) };
        const client = await makeClient(service, cwd, runtimeRoot);
        const requiredCapabilities = [];
        if (Object.keys(sessionSettings).length) requiredCapabilities.push('delivery.session-options.v1');
        if (['maxTools', 'maxSeconds', 'maxRepairs'].some(key => options[key] !== undefined)) requiredCapabilities.push('delivery.budgets.v1');
        if (options.delivery === false || options.strict === false) requiredCapabilities.push('delivery.policy-overrides.v1');
        if (requiredCapabilities.length) {
          const definitions = native.rpcDefinitions ?? await nativeRpcDefinitions();
          const health = await client.rpc(definitions.Carthagent).health({}, { location: { directory: cwd }, signal: signal.controller.signal });
          const advertised = health?.capabilities;
          if (!Array.isArray(advertised) || requiredCapabilities.some(capability => !advertised.includes(capability))) {
            throw new Error(`The active native plugin does not advertise required enforcement capabilities: ${requiredCapabilities.filter(capability => !advertised?.includes(capability)).join(', ')}.`);
          }
        }
        if (mode === 'headless' && !options.session && (options.continue || options.resume)) {
          options.session = await latestSessionForWorkspace(client, cwd);
          if (!options.session) throw new Error('No native OpenCode session exists for this workspace to continue.');
        }
        eventController = new AbortController();
        const nativeEvents = [];
        let eventFailure;
        const eventStream = mode === 'headless' && options.json ? client.event?.subscribe?.({ signal: eventController.signal }) : undefined;
        eventReader = eventStream ? (async () => {
          try { for await (const event of eventStream) nativeEvents.push(event); }
          catch (error) { if (!eventController.signal.aborted) eventFailure = error; }
        })() : Promise.resolve();
        if (mode === 'interactive') {
          let sessionID = options.session;
          if (!sessionID && (options.continue || options.resume)) {
            sessionID = await latestSessionForWorkspace(client, cwd);
          if (!sessionID) throw new Error('No native OpenCode session exists for this workspace to resume.');
        }
        if (mode === 'interactive' && !sessionID && options.autoFraming === false) {
          const created = await headlessApi.createSession(service, cwd, { body: {
            title: promptText.slice(0, 80),
            ...(model ? { model } : {}),
            metadata,
          } });
          sessionID = created.id;
        }
        if (options.autoFraming !== undefined && mode === 'interactive' && sessionID) {
          const definitions = native.rpcDefinitions ?? await nativeRpcDefinitions();
          await client.rpc(definitions.SessionControls).framing({ sessionID, enabled: options.autoFraming }, { location: { directory: cwd }, signal: signal.controller.signal });
        }
        if (framedPrompt) {
          if (!sessionID) {
            const created = await headlessApi.createSession(service, cwd, { body: {
              title: promptText.slice(0, 80),
              ...(model ? { model } : {}),
              metadata,
            } });
            sessionID = created.id;
          } else {
            await persistSessionOptions(client, sessionID, metadata, sessionSettings, { signal: signal.controller.signal, directory: cwd });
          }
          if (options.autoFraming !== undefined) {
            const definitions = native.rpcDefinitions ?? await nativeRpcDefinitions();
            await client.rpc(definitions.SessionControls).framing({ sessionID, enabled: options.autoFraming }, { location: { directory: cwd }, signal: signal.controller.signal });
          }
          const requiredChecks = options.validators ? loadRequiredChecks(resolve(cwd, options.validators), cwd) : [];
          if (requiredChecks.length) {
            const checks = requiredChecks.map(check => `${check.id}: ${JSON.stringify(check)}`).join('\n');
            const existingContext = promptText ? `\n\nTask context:\n${promptText}` : '';
            const validatorInstructions = `\n\nRequired user-owned validators (non-negotiable; run exactly these checks and do not remove or weaken them):\n${checks}${existingContext}`;
            // Required check metadata is stored per session as part of the native option payload;
            // the delivery plugin resolves the path and enforces these checks when integrated.
            await client.session.update({ sessionID, metadata: { ...metadata, 'carthagent.requiredChecks': requiredChecks } });
            if (!framedPrompt.includes(validatorInstructions.trim())) {
              await headlessApi.promptSession(service, sessionID, validatorInstructions, { signal: signal.controller.signal, body: { delivery: 'queue' } });
            }
          }
          await headlessApi.promptSession(service, sessionID, framedPrompt, { signal: signal.controller.signal, body: { metadata: { 'ctg.framed': true } } });
        }
        const tuiService = options.engineCli
          ? { ...service, binary: await runtime.resolveOpenCode({ binary: options.engineCli }) }
          : service;
        const child = serviceApi.launchTui(tuiService, cwd, {
          sessionID,
          continue: Boolean(options.continue),
          env: sessionEnv,
          theme: options.theme,
          glyphs: resolvedGlyphs,
        });
        const onSignal = () => child.kill('SIGINT');
        process.once('SIGINT', onSignal);
        try { return await childExit(child); } finally { process.removeListener('SIGINT', onSignal); }
      }
      let result;
      let headlessError;
      const requestedSession = options.session;
      if (requestedSession && Object.keys(sessionSettings).length && !signal.controller.signal.aborted) {
        await persistSessionOptions(client, requestedSession, metadata, sessionSettings, { signal: signal.controller.signal, directory: cwd });
      }
      if (requestedSession && options.autoFraming !== undefined && !signal.controller.signal.aborted) {
        const definitions = native.rpcDefinitions ?? await nativeRpcDefinitions();
        await client.rpc(definitions.SessionControls).framing({ sessionID: requestedSession, enabled: options.autoFraming }, { location: { directory: cwd }, signal: signal.controller.signal });
      }
      try {
        result = await headlessApi.runHeadless(service, cwd, framedPrompt || prompt || '', {
          sessionID: options.session,
          session: {
            title: promptText.slice(0, 80), ...(model ? { model } : {}), metadata,
          },
          env: sessionEnv,
          signal: signal.controller.signal,
        });
      } catch (error) {
        if (!options.json || !options.session) throw error;
        headlessError = error;
        result = { session: { id: options.session }, messages: [], outcome: signal.controller.signal.aborted ? 'interrupted' : 'failed', terminal: true, error: error.message };
      }
        const latest = headlessError ? result : await reconcileHeadlessResult(result, { client, signal: signal.controller.signal });
        eventController.abort();
        await eventReader;
        if (eventFailure) throw new Error(`Native OpenCode event stream failed: ${eventFailure.message}`, { cause: eventFailure });
        const text = textParts(latest.messages);
        if (options.json) {
          const sessionID = latest.session?.id;
          const preAdmission = latest.terminal === false && !latest.accepted;
          for (const event of nativeJsonEvents(preAdmission ? [] : nativeEvents, preAdmission ? undefined : sessionID, latest.messages || [], {
            outcome: latest.outcome || latest.session?.outcome || (headlessError ? signal.controller.signal.aborted ? 'interrupted' : 'failed' : undefined),
            error: latest.error || latest.session?.error || headlessError?.message,
          })) stdout.write(`${JSON.stringify(event)}\n`);
          if (!preAdmission && sessionID && headlessError && !nativeEvents.some(event => event.type === 'session.execution.failed' && event.data?.sessionID === sessionID)) {
            const hasAssistantFailure = (latest.messages || []).some(message => (message?.role === 'assistant' || message?.info?.role === 'assistant' || message?.type === 'assistant')
              && (message.finish ?? message.info?.finish ?? message.info?.status ?? message.status) === 'error');
            if (!hasAssistantFailure) {
              const failedAssistant = { type: 'assistant', finish: 'error', errorMessage: headlessError.message, content: [] };
              stdout.write(`${JSON.stringify({ type: 'message', sessionID: latest.session.id, message: failedAssistant })}\n`);
              stdout.write(`${JSON.stringify({ type: 'message_end', sessionID: latest.session.id, message: { role: 'assistant', content: [], stopReason: 'error', error: headlessError.message } })}\n`);
            }
          }
      } else if (text.length) stdout.write(`${text.join('\n')}\n`);
      return headlessSucceeded(latest) ? 0 : 1;
    } finally {
      eventController?.abort();
      await eventReader;
      signal.dispose();
      if (isolatedRoot && isolatedEnsureAttempted && serviceApi.stopService) {
        try {
          const stopped = await serviceApi.stopService({ root: isolatedRoot });
          let registrationExists = false;
          const paths = runtime.runtimePaths?.({ root: isolatedRoot });
          if (paths?.serviceFile) {
            try { await readFile(paths.serviceFile); registrationExists = true; }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
          if (stopped || (!registrationExists && !ownedIsolatedService)) await rm(isolatedRoot, { recursive: true, force: true });
        } catch (error) {
          io.error(`Could not clean up isolated OpenCode profile ${isolatedRoot}: ${error.message}`);
        }
      }
    }
  }

  async function listModels({ query = '' } = {}) {
    const { client } = await serviceClient();
    const data = await client.model.list({ location: { directory: cwd } });
    const term = query.trim().toLowerCase();
    const rows = modelRows(data)
      .filter(model => !term || `${model.providerName} ${model.providerID} ${model.id} ${model.name}`.toLowerCase().includes(term))
      .sort((a, b) => a.providerName.localeCompare(b.providerName) || String(a.id).localeCompare(String(b.id)));
    for (const model of rows) {
      const inputCost = Array.isArray(model.cost) ? model.cost[0]?.input : model.cost?.input;
      const outputCost = Array.isArray(model.cost) ? model.cost[0]?.output : model.cost?.output;
      io.log([model.providerName, model.modelID || model.id, model.limit?.context ?? model.contextWindow, model.limit?.output ?? model.maxTokens, inputCost, outputCost]
        .map(value => value == null ? '?' : value).join('  '));
    }
    return rows.length;
  }

  async function login({ args = [] } = {}) {
    if (typeof stdin?.isTTY === 'boolean' && !stdin.isTTY) throw new Error('login requires an interactive terminal.');
    if (typeof stdout?.isTTY === 'boolean' && !stdout.isTTY) throw new Error('login requires an interactive terminal.');
    const controller = new AbortController();
    const onInterrupt = () => {
      const error = new Error('Login cancelled.');
      error.name = 'AbortError';
      error.code = 'SIGINT';
      controller.abort(error);
    };
    process.once('SIGINT', onInterrupt);
    let client;
    let location;
    let integration;
    let attempt;
    let completed = false;
    try {
    ({ client } = await serviceClient());
    location = { directory: cwd };
    const listed = await client.integration.list({ location }, { signal: controller.signal });
    controller.signal.throwIfAborted();
    const integrations = Array.isArray(listed?.data) ? listed.data : [];
    const target = args[0];
    const interactive = integrations.filter(item => item.methods.some(method => method.type !== 'env'));
    integration = target
      ? integrations.find(item => item.id === target || item.name.toLowerCase() === target.toLowerCase())
      : interactive.find(item => item.id === 'experiential-labs') || interactive[0];
    if (!target && interactive.length > 1) {
      const prompt = readlineFactory({ input: stdin, output: stdout });
      const choices = interactive.map((item, index) => `${index + 1}) ${item.name}`).join('\n');
      const selected = await questionWithAbort(prompt, `Select provider:\n${choices}\nProvider number: `, controller.signal);
      const index = Number(selected) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= interactive.length) throw new Error('Select a listed provider number.');
      integration = interactive[index];
    }
    if (!integration) throw new Error(target ? `Integration not found: ${target}` : 'No provider integrations with an interactive authentication method are available.');
    const methods = integration.methods.filter(method => method.type !== 'env');
    if (!methods.length) throw new Error(`${integration.name} has no interactive authentication method.`);
    const methodName = args[1];
    const method = methodName
      ? methods.find(item => item.type === 'key' ? methodName.toLowerCase() === 'key' : item.id === methodName || item.label.toLowerCase() === methodName.toLowerCase())
      : methods[0];
    if (!method) throw new Error(`Authentication method not found: ${methodName}. Available: ${methods.map(item => item.type === 'key' ? 'key' : item.id).join(', ')}`);
    const answer = {};
    if (method.form?.length) {
      for (const field of method.form) {
        if (!formFieldActive(field, answer)) continue;
        const title = field.title || field.key;
        const secret = field.type === 'string' && /(?:secret|token|password|api.?key|private.?key)/i.test(`${field.key} ${title}`);
        let value;
        if (field.hidden) {
          value = field.default;
          if (value === undefined && field.required) throw new Error(`Hidden required authentication field ${field.key} has no default and cannot be prompted securely.`);
          if (value !== undefined) answer[field.key] = normalizeFormValue(field, value);
          else if (field.type === 'boolean') answer[field.key] = false;
          continue;
        }
        const label = `${title}${field.required ? ' (required)' : ''}`;
        if (secret) value = await questionMasked(stdin, stdout, label, controller.signal);
        else if (field.type === 'boolean') {
          const choices = ['true', 'false'];
          const defaultValue = field.default === undefined ? 'false' : String(field.default);
          const prompt = readlineFactory({ input: stdin, output: stdout });
          value = await questionWithAbort(prompt, `${label} [${choices.join('/')}] (default ${defaultValue}): `, controller.signal);
          if (!value) value = defaultValue;
          if (!choices.includes(String(value).toLowerCase())) throw new Error(`${title} must be true or false.`);
        } else if (field.type === 'multiselect') {
          const optionText = (field.options || []).map(option => `${option.value} (${option.label})`).join(', ');
          const prompt = readlineFactory({ input: stdin, output: stdout });
          value = await questionWithAbort(prompt, `${label}${optionText ? ` [${optionText}]` : ''} (comma-separated${field.default ? `; default ${field.default.join(',')}` : ''}): `, controller.signal);
          if (!value && field.default !== undefined) value = field.default;
        } else {
          const prompt = readlineFactory({ input: stdin, output: stdout });
          const choices = field.options?.length ? ` [${field.options.map(option => `${option.value} (${option.label})`).join(', ')}]` : '';
          value = await questionWithAbort(prompt, `${label}${choices}${field.default !== undefined ? ` (default ${field.default})` : ''}: `, controller.signal);
          if (value === '' && field.default !== undefined) value = field.default;
        }
        if ((value === '' || value == null) && field.required) throw new Error(`${title} is required.`);
        if ((value === '' || value == null) && field.type === 'boolean') answer[field.key] = field.default ?? false;
        else if (value !== '' && value != null) answer[field.key] = normalizeFormValue(field, value);
      }
    }
    if (method.type === 'external') {
      await client.integration.connect.external({ integrationID: integration.id, methodID: method.id, answer, location }, { signal: controller.signal });
      io.log(`Connected to ${integration.name}.`);
      return 0;
    }
    if (method.type === 'key') {
      const secretField = method.form?.find(field => field.type === 'string' && /(?:secret|token|password|api.?key|private.?key)/i.test(`${field.key} ${field.title || ''}`));
      const key = secretField ? answer[secretField.key] : await questionMasked(stdin, stdout, `${integration.name} API key`, controller.signal);
      if (typeof key !== 'string' || !key.trim()) throw new Error('An API key is required.');
      await client.integration.connect.key({ integrationID: integration.id, key, answer, location }, { signal: controller.signal });
      io.log(`Connected to ${integration.name}.`);
      completed = true;
      return 0;
    }
    if (method.type !== 'oauth') throw new Error(`Authentication method ${method.type} is not supported by native CLI login.`);

      const started = await client.integration.oauth.connect({ integrationID: integration.id, methodID: method.id, answer, location }, { signal: controller.signal });
      // The host may complete connect despite an abort racing its response.
      // Capture its attempt ID before observing the signal so finally can
      // cancel the server-side flow.
      attempt = started.data;
      controller.signal.throwIfAborted();
      io.log(attempt.instructions);
      io.log(attempt.url);
      if (stdin?.isTTY && stdout?.isTTY) await openBrowserImpl(attempt.url).catch(() => false);
      if (attempt.mode === 'code') {
        const prompt = readlineFactory({ input: stdin, output: stdout });
        let code;
        code = await questionWithAbort(prompt, 'Paste the authorization code: ', controller.signal);
        if (!code.trim()) throw new Error('Authorization code is required.');
        await client.integration.oauth.complete({ integrationID: integration.id, attemptID: attempt.attemptID, code: code.trim(), location }, { signal: controller.signal });
        io.log(`Connected to ${integration.name}.`);
        completed = true;
        return 0;
      }
      io.log('Waiting for authorization… (Ctrl+C to cancel)');
      while (!controller.signal.aborted && Date.now() < attempt.time.expires) {
        const response = await client.integration.oauth.status({ integrationID: integration.id, attemptID: attempt.attemptID, location }, { signal: controller.signal });
        const status = response.data;
        if (status.status === 'complete') { io.log(`Connected to ${integration.name}.`); completed = true; return 0; }
        if (status.status === 'failed') throw new Error(status.message || 'Authorization failed.');
        if (status.status === 'expired') throw new Error('Authorization expired.');
        await new Promise((resolve, reject) => {
          if (controller.signal.aborted) return reject(controller.signal.reason);
          const finish = callback => value => {
            clearTimeout(timer);
            controller.signal.removeEventListener('abort', abort);
            callback(value);
          };
          const timer = setTimeout(finish(resolve), 500);
          const abort = () => finish(reject)(controller.signal.reason);
          controller.signal.addEventListener('abort', abort, { once: true });
        });
      }
      if (controller.signal.aborted) throw controller.signal.reason;
      throw new Error('Authorization expired.');
    } finally {
      process.removeListener('SIGINT', onInterrupt);
      if (attempt && !completed) await client.integration.oauth.cancel({ integrationID: integration.id, attemptID: attempt.attemptID, location }, { signal: AbortSignal.timeout(5_000) }).catch(() => {});
    }
  }

  async function shipCredential() {
    const { client } = await serviceClient();
    const { Carthagent } = native.rpcDefinitions ?? await nativeRpcDefinitions();
    return { client, rpc: client.rpc(Carthagent) };
  }

  async function archiveRequest(method, input = {}) {
    const { client } = await serviceClient();
    const { Archive } = native.rpcDefinitions ?? await nativeRpcDefinitions();
    return client.rpc(Archive)[method](input, { location: { directory: cwd } });
  }

  async function archive({ args = [] } = {}) {
    const [action = 'list', ...rest] = args;
    if (action === 'list' || action === 'search') {
      const query = action === 'search' ? rest.shift() : undefined;
      if (action === 'search' && !query) throw Object.assign(new Error('Usage: ctg archive search <query> [--json]'), { exitCode: 2 });
      const json = rest.includes('--json');
      const pages = [];
      let offset = 0;
      do {
        const page = await archiveRequest(action, { ...(query ? { query } : {}), offset, limit: 100 });
        pages.push(...page.items);
        offset += page.items.length;
        if (!page.items.length || offset >= page.total) break;
      } while (true);
      if (json) io.log(JSON.stringify(pages));
      else for (const item of pages) io.log(`${item.id} · ${item.messageCount} messages · ${item.createdAt || 'date unknown'}${item.excerpt ? `\n  ${item.excerpt}` : ''}`);
      return 0;
    }
    if (action === 'read' || action === 'export') {
      const id = rest.shift();
      if (!id) throw Object.assign(new Error(`Usage: ctg archive ${action} <id>${action === 'export' ? ' [--format json|jsonl]' : ''}`), { exitCode: 2 });
      if (action === 'read') {
        const data = await archiveRequest('read', { id });
        io.log(JSON.stringify(data, null, 2));
        return 0;
      }
      let format = 'json';
      for (let index = 0; index < rest.length; index++) {
        if (rest[index] === '--format' && ['json', 'jsonl'].includes(rest[index + 1])) format = rest[++index];
        else throw Object.assign(new Error('Usage: ctg archive export <id> [--format json|jsonl]'), { exitCode: 2 });
      }
      const result = await archiveRequest('export', { id, format });
      stdout.write(`${result.content}${result.content.endsWith('\n') ? '' : '\n'}`);
      return 0;
    }
    throw Object.assign(new Error('Usage: ctg archive [list|search <query>|read <id>|export <id> [--format json|jsonl]]'), { exitCode: 2 });
  }

  async function cloudClient(accessToken) {
    const { CloudClient, cloudControlUrl, formatCloudAccount, formatNanoUsd, openBrowser, cloudManagedUsageRecovery } = await import('../cloud/client.mjs');
    return { client: new CloudClient({ baseUrl: cloudControlUrl() }), formatCloudAccount, formatNanoUsd, openBrowser, cloudManagedUsageRecovery, accessToken };
  }

  async function account({ args = [] } = {}) {
    const auth = await shipCredential();
    let result;
    try { result = (await auth.rpc.shipAccount({}, { location: { directory: cwd } })).account; }
    catch (error) { throw new Error(shipLoginGuidance(error) || `Carthagent Ship: ${error.message}`); }
    const cloud = await cloudClient('');
    if (args.includes('--json')) io.log(JSON.stringify(result));
    else {
      io.log(cloud.formatCloudAccount(result));
      io.log('\nCredit grants:');
      for (const grant of result.grants || []) io.log(`  ${cloud.formatNanoUsd(grant.remainingNanoUsd)} remaining of ${cloud.formatNanoUsd(grant.originalNanoUsd)} · ${grant.source}${grant.expiresAt ? ` · expires ${grant.expiresAt}` : ''}`);
      io.log('\nCLI sessions:');
      for (const session of result.sessions || []) io.log(`  ${session.id} · ${session.revoked_at ? 'revoked' : 'active'} · ${session.client_name || 'Carthagent CLI'} · last used ${session.last_used_at || session.created_at}`);
    }
    return 0;
  }

  async function billing({ action }) {
    const auth = await shipCredential();
    const result = await auth.rpc.shipBilling({ action }, { location: { directory: cwd } });
    const opened = await openBrowserImpl(result.url).catch(() => false);
    io.log(`${opened ? 'Opened' : 'Open'} ${result.url}`);
    return 0;
  }

  async function logout({ session: sessionID }) {
    const auth = await shipCredential();
    let result;
    try { result = await auth.rpc.shipLogout({ ...(sessionID ? { session: sessionID } : {}) }, { location: { directory: cwd } }); }
    catch (error) { throw new Error(shipLoginGuidance(error) || `Carthagent Ship logout: ${error.message}`); }
    if (!sessionID && result.credentialID) {
      await auth.client.credential.remove({ credentialID: result.credentialID });
    }
    io.log(sessionID ? `Revoked Ship session ${sessionID}.` : 'Revoked and removed the current Carthagent Ship session.');
    return 0;
  }

  async function review({ args }) {
    if (!args.length || (args.length === 1 && args[0] === 'status')) {
      const config = loadCarthagentConfig();
      io.log(`self-review default: ${resolveReviewMode(undefined, config)} (config: ${config.review ?? 'unset'} @ ${carthagentConfigPath()})`);
      return 0;
    }
    const mode = args.length === 1 ? normalizeReviewMode(args[0]) : null;
    if (mode) { saveCarthagentConfig({ review: mode }); io.log(`self-review default → ${mode} (saved to ${carthagentConfigPath()})`); return 0; }
    let timeoutMs = 300_000;
    let target;
    let requestFile;
    for (let index = 0; index < args.length; index++) {
      const value = args[index];
      if (value === '--timeout') {
        const seconds = Number(args[++index]);
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw Object.assign(new Error('Review timeout must be an integer from 1 to 300'), { exitCode: 2 });
        timeoutMs = seconds * 1000;
      } else if (value === '--request-file') {
        if (requestFile || !args[index + 1] || args[index + 1].startsWith('-')) throw Object.assign(new Error('Use ctg review workspace --request-file <original-task.txt>'), { exitCode: 2 });
        requestFile = args[++index];
      } else if (value.startsWith('-') || target !== undefined) {
        throw Object.assign(new Error(`Invalid review argument: ${value}. Use ctg review [status|ask|yes|no|workspace --request-file <file>|<PR number or URL>] [--timeout 1..300]`), { exitCode: 2 });
      } else target = value;
    }
    let reviewTask;
    if (target === 'workspace') {
      if (!requestFile) throw Object.assign(new Error('Use ctg review workspace --request-file <original-task.txt>'), { exitCode: 2 });
      const file = resolve(cwd, requestFile);
      try {
        if (!(await stat(file)).isFile()) throw new Error('not a regular file');
        reviewTask = await readFile(file, 'utf8');
      } catch {
        throw Object.assign(new Error(`Review request file is not a readable regular file: ${requestFile}`), { exitCode: 2 });
      }
    } else if (requestFile) {
      throw Object.assign(new Error('--request-file is only valid with `ctg review workspace`.'), { exitCode: 2 });
    } else if (target !== undefined && !/^(?:[1-9]\d*|https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*\/?)$/.test(target)) {
      throw Object.assign(new Error(`Invalid review target: ${target}. Use workspace, a positive PR number, or a GitHub pull-request URL.`), { exitCode: 2 });
    } else if (target === undefined) {
      throw Object.assign(new Error('Review target is required. Use workspace, a positive PR number, or a GitHub pull-request URL.'), { exitCode: 2 });
    }
    const { client } = await serviceClient();
    const { startReview, startPullRequestReview } = await import(pathToFileURL(join(runtimeRoot, 'lib/opencode/review.mjs')).href);
    const ctx = {
      session: {
        create: (input, options) => client.session.create({
          title: input.title,
          ...(input.agent ? { agent: input.agent } : {}),
          ...(input.model ? { model: input.model } : {}),
          location: input.location || { directory: cwd },
          ...(input.permissions ? { permissions: input.permissions } : {}),
        }, options),
        prompt: (input, options) => client.session.prompt({
          sessionID: input.sessionID,
          text: reviewTask ? `${input.text}\n\nOriginal task to use as review criteria:\n${reviewTask}` : input.text,
          ...(input.metadata ? { metadata: input.metadata } : {}),
        }, options),
        wait: (input, options) => client.session.wait(input, options),
        context: (input, options) => client.session.context(input, options),
        get: (input, options) => client.session.get(input, options),
        interrupt: (input, options) => client.session.interrupt(input, options),
      },
      agent: { list: async (_input, options) => {
        // Materialize the location instance first; this runs the host's
        // location lifecycle (including project activation) before inventory.
        await client.location.get({ location: { directory: cwd } }, options);
        return client.agent.list({ location: { directory: cwd } }, options);
      } },
    };
    if (target === 'workspace') {
      const result = await startReview({ ctx, cwd, identity: `workspace:${cwd}`, timeoutMs });
      io.log(`VERDICT: ${result.verdict}`);
      return result.verdict === 'APPROVE' ? 0 : 1;
    }
    if (target !== undefined) {
      const view = await runCommand(['gh', 'pr', 'view', target, '--json', 'url,number'], { cwd, timeoutSeconds: 30 });
      if (view.code !== 0) throw Object.assign(new Error(view.output.trim() || `Cannot load PR ${target}; verify gh authentication and repository.`), { exitCode: 2 });
      const meta = JSON.parse(view.output);
      const remote = await runCommand(['git', 'remote', 'get-url', 'origin'], { cwd, timeoutSeconds: 10 });
      if (remote.code !== 0) throw Object.assign(new Error(remote.output.trim() || 'Cannot determine the GitHub repository from origin'), { exitCode: 2 });
      const repository = remote.output.trim()
        .replace(/^git@github\.com:/, '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw Object.assign(new Error('Origin is not a supported GitHub owner/repository URL'), { exitCode: 2 });
      const outcome = await startPullRequestReview({ ctx, cwd, repository, prNumber: Number(meta.number), timeoutMs });
      io.log(`VERDICT: ${outcome.verdict}`);
      return outcome.verdict === 'APPROVE' ? 0 : 1;
    }
  }

  async function domain({ command, args = [] }) {
    if (['s', 'fingerprint', 'c'].includes(command)) command = ({ s: 'status', fingerprint: 'hash', c: 'check' })[command];
    if (command === 'status') {
      const currentFp = fingerprint(cwd, ['.']);
      const report = latestReport(cwd);
      if (args.includes('--json')) {
        const state = report?.state;
        io.log(JSON.stringify({ version: 1, workspace: cwd, currentFingerprint: currentFp, report: report?.path || null, state: state || null, planningView: planningView(state, currentFp), completionIssues: state?.plan ? completionIssues(state, cwd, currentFp) : null }));
        return 0;
      }
      io.log(`Workspace:     ${cwd}`);
      io.log(`Fingerprint:   ${currentFp}`);
      if (!report?.state?.plan) { io.log('No delivery report found for this workspace.'); return 0; }
      const { state } = report;
      io.log(`Status:        ${state.status}`);
      io.log(`Goal:          ${state.plan.goal}`);
      io.log(`Checks:        ${state.plan.checks.map(check => {
        const evidence = state.evidence?.[check.id];
        if (!evidence) return `pending:${check.id}`;
        if (!evidence.passed) return `failed:${check.id}`;
        return `${evidenceFresh(check, evidence, currentFp, state) ? 'passed' : 'stale'}:${check.id}`;
      }).join(', ')}`);
      io.log(`Report:        ${report.path}`);
      return 0;
    }
    if (command === 'hash') {
      io.log(fingerprint(cwd, args.length ? args : ['.']));
      return 0;
    }
    if (command === 'validate') {
      if (!args[0]) throw new Error('Usage: ctg validate <path-to-plan.json>');
      const plan = JSON.parse(await readFile(resolve(cwd, args[0]), 'utf8'));
      const validated = validatePlan(plan, cwd);
      io.log('✓ Acceptance contract is VALID.');
      io.log(`Goal: ${validated.goal}`);
      io.log(`Checks: ${validated.checks.map(check => check.id).join(', ')}`);
      io.log(`\nGenerated D2 Outline:\n${planD2(validated)}`);
      return 0;
    }
    if (command === 'check') {
      const release = lockWorkspace(cwd);
      try {
        const report = latestReport(cwd);
        if (!report?.state?.plan) { io.error('No delivery report found for this workspace.'); return 1; }
        selectReport(cwd, report.path);
        const state = report.state;
        const checkID = args[0] || 'all';
        const checks = checkID === 'all' ? state.plan.checks : state.plan.checks.filter(check => check.id === checkID);
        if (!checks.length) { io.error(`Unknown check ID: ${checkID}`); return 1; }
        startImplementation(state, fingerprint(cwd, ['.']));
        let allPassed = true;
        const priorStatus = state.status;
        state.status = 'verifying'; state.verificationStarted = true; saveReport(report.path, state);
        for (const check of checks) {
          const before = fingerprint(cwd, ['.']);
          io.log(`\n${check.id}  ${check.argv.join(' ')}`);
          const result = await runCommand(check.argv, { cwd, timeoutSeconds: check.timeoutSeconds, logPath: join(report.dir, `${check.id}-${randomUUID()}.log`) });
          const after = fingerprint(cwd, ['.']);
          const passed = result.code === 0 && !result.timedOut && !result.cancelled && !result.outputLimit && before === after;
          state.evidence[check.id] = { passed, fingerprint: after, executedRevision: state.revision, code: result.code, timedOut: result.timedOut, cancelled: result.cancelled, outputLimit: result.outputLimit, changedDuringCheck: before !== after, durationMs: result.durationMs, logPath: result.logPath, outputTail: result.output.slice(-1200) };
          saveReport(report.path, state);
          if (result.output) io.log(result.output.trim());
          io.log(passed ? `passed (${result.durationMs}ms)` : `failed (exit ${result.code})`);
          allPassed &&= passed;
        }
        const complete = Object.values(completionIssues(state, cwd, fingerprint(cwd, ['.']))).every(items => items.length === 0);
        state.status = allPassed && complete && priorStatus === 'verified' ? 'verified' : 'implementing';
        saveReport(report.path, state);
        return allPassed ? 0 : 1;
      } finally { release(); }
    }
    throw new Error(`Unsupported native domain command: ${command}`);
  }

  async function command({ command, args }) {
    if (command === 'demo') {
      const { runOfflineDemo } = await import('./demo.mjs');
      return runOfflineDemo({ io, nodeBinary: process.env.CTG_NODE_EXECUTABLE || process.execPath, ...(native.demoExecute ? { execute: native.demoExecute } : {}) });
    }
    if (command === 'test') return runCommand([process.execPath, '--test', 'tests/*.test.mjs'], { cwd: runtimeRoot, timeoutSeconds: 600 }).then(result => result.code);
    if (command === 'eval') return runCommand([process.execPath, join(runtimeRoot, 'evaluate.mjs'), ...args], { cwd: runtimeRoot, timeoutSeconds: 600 }).then(result => result.code);
    if (command === 'serve') {
      const child = spawn(process.execPath, [join(runtimeRoot, 'server.mjs')], { cwd: runtimeRoot, env: { ...process.env, CARTHAGENT_WORKSPACE: cwd }, stdio: 'inherit' });
      return childExit(child);
    }
    if (command === 'update') {
      const updateModule = native.updateModule ?? await import('./update.mjs');
      const updateApi = native.updateApi ?? {};
      const packageRoot = modules.packageRoot || runtimeRoot;
      await updateModule.runNativeUpdate({
        args, io, cwd: packageRoot, root: packageRoot,
        ...(updateApi.packageVersion ? { currentVersion: updateApi.packageVersion() } : {}),
        ...(updateApi.fetchLatestRelease ? { fetchLatestRelease: updateApi.fetchLatestRelease } : {}),
        ...(updateApi.detectInstallMethod ? { detectInstallMethod: updateApi.detectInstallMethod } : {}),
        ...((native.runCommand || updateApi.runCommand) ? { runCommand: native.runCommand || updateApi.runCommand } : {}),
      });
      return 0;
    }
    if (command === 'quit' || command === 'q' || command === 'exit') {
      if (args.length) throw Object.assign(new Error(`Usage: ctg ${command}`), { exitCode: 2 });
      io.log('There is no active native CLI session to quit.');
      return 0;
    }
    throw new Error(`Native command ${command} is not wired to a native implementation yet`);
  }

  return { run, listModels, login, account, billing, logout, archive, review, domain, command };
}

export { hasHeadlessTerminal, headlessSucceeded, latestSessionForWorkspace, modelWithThinking, nativeJsonEvents, providerModel, reconcileHeadlessResult, textParts };
