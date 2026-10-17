import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fingerprint, completionIssues, evidenceFresh, validatePlan, planD2, runCommand } from '../delivery.mjs';
import { lockWorkspace, selectReport } from '../workspace.mjs';
import { latestReport, saveReport } from '../reports.mjs';
import { startImplementation } from '../planning.mjs';
import { planningView } from '../planning-view.mjs';
import { validateBudgetOptions } from '../budget.mjs';
import { loadRequiredChecks } from '../delivery.mjs';
import { normalizeReviewMode, resolveReviewMode, loadCarthagentConfig, saveCarthagentConfig, carthagentConfigPath } from '../review.mjs';
import { randomUUID } from 'node:crypto';

const HERE = new URL('.', import.meta.url);
const ROOT = resolve(fileURLToPath(new URL('../..', HERE)));
const SESSION_OPTIONS_KEY = 'carthagent.options';

async function nativeModules() {
  const runtimeRoot = process.env.CTG_NATIVE_RUNTIME_ROOT || ROOT;
  const load = (file) => import(pathToFileURL(join(runtimeRoot, 'lib/opencode', file)).href);
  const [runtime, service, headless] = await Promise.all([
    load('runtime.mjs'), load('service.mjs'), load('headless.mjs'),
  ]);
  return { runtime, service, headless, runtimeRoot };
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
    } else if (['failed', 'interrupted', 'succeeded'].includes(terminalState.outcome)) {
      emit({ type: 'message', sessionID, message: { type: 'idle', outcome: terminalState.outcome, ...(terminalState.error ? { error: terminalState.error } : {}) } });
    }
  }
  if (!sessionID && ['failed', 'interrupted', 'succeeded'].includes(terminalState.outcome)) {
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
  // The runtime uses terminal:false for calls that never crossed prompt
  // admission (including pre-aborted requests). Session history can only be
  // from an earlier turn in that case, so do not query or attach it.
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

function sessionOptionsMetadata(options, cwd) {
  const values = {};
  for (const key of ['delivery', 'guide', 'strict', 'isolate', 'maxTools', 'maxSeconds', 'maxRepairs', 'bashCap', 'workflow', 'review']) {
    if (options[key] !== undefined) values[key] = options[key];
  }
  for (const key of ['validators', 'context']) {
    if (options[key] !== undefined) values[key] = resolve(cwd, options[key]);
  }
  return { [SESSION_OPTIONS_KEY]: values };
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

export async function createOpenCodeCliRuntime({ cwd = process.cwd(), io = console, stdout = process.stdout, stdin = process.stdin, native = {} } = {}) {
  const modules = native.runtime && native.service && native.headless ? native : await nativeModules();
  const { runtime, service: serviceApi, headless: headlessApi } = modules;
  const runtimeRoot = modules.runtimeRoot || ROOT;
  const makeClient = native.clientFactory || (async service => {
    const { OpenCode } = await import('@opencode/client');
    return OpenCode.make({ baseUrl: service.url, headers: service.headers });
  });
  const pluginPath = join(runtimeRoot, 'plugins/carthagent');
  const runtimeOptions = {
    pluginPath,
    ...(process.env.CTG_OPENCODE_HOME ? { root: process.env.CTG_OPENCODE_HOME } : {}),
  };
  const ensure = (options = {}) => serviceApi.ensureService({ ...runtimeOptions, ...(options.binary ? { binary: options.binary } : {}) });
  const serviceClient = async (options = {}) => {
    const service = await ensure(options);
    return { service, client: await makeClient(service, cwd, runtimeRoot), cwd, runtimeRoot };
  };

  async function run({ mode, options, prompt }) {
    if (options.demo) throw new Error('The scripted ctg demo still depends on the legacy agent RPC protocol and is not available in the native CLI.');
    const sticky = (await import('../review.mjs')).resolveStickyDefaults(options);
    options.theme ??= sticky.theme;
    options.model ??= sticky.model;
    validateBudgetOptions(options);
    for (const [key, max] of [['maxTools', 1_000_000], ['maxSeconds', 1_000_000], ['maxRepairs', 1_000_000]]) {
      if (options[key] !== undefined && (!/^\d+$/.test(String(options[key])) || Number(options[key]) > max)) {
        throw new Error(`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)} must be an integer from 0 to ${max}`);
      }
    }
    if (options.bashCap !== undefined && (!/^\d+(?:\.\d+)?$/.test(String(options.bashCap)) || Number(options.bashCap) <= 0)) {
      throw new Error('--bash-cap must be a positive number of seconds');
    }
    if (options.delivery === false) throw new Error('--no-delivery is not supported while the CTG native delivery policy plugin is active.');
    if (options.strict === false) throw new Error('--no-strict is not supported until native delivery policy overrides are implemented.');
    if (options.bashCap !== undefined) throw new Error('--bash-cap is not supported until native shell caps are enforced.');
    if (options.isolate) throw new Error('--isolate is not supported until native profile isolation is implemented.');
    for (const key of ['maxTools', 'maxSeconds', 'maxRepairs']) {
      if (options[key] !== undefined) throw new Error(`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)} is not supported until the active native delivery plugin enforces session budgets.`);
    }
    const sessionSettings = {
      ...(options.strict === undefined ? {} : { strict: options.strict }),
      ...(options.delivery === undefined ? {} : { delivery: options.delivery }),
      ...(options.autoFraming === undefined ? {} : { guide: options.autoFraming }),
      ...(options.isolate === undefined ? {} : { isolate: options.isolate }),
      ...(options.workflow ? { workflow: options.workflow } : {}),
      ...(options.maxTools !== undefined ? { maxTools: options.maxTools } : {}),
      ...(options.maxSeconds !== undefined ? { maxSeconds: options.maxSeconds } : {}),
      ...(options.maxRepairs !== undefined ? { maxRepairs: options.maxRepairs } : {}),
      ...(options.bashCap !== undefined ? { bashCap: options.bashCap } : {}),
      ...(options.validators ? { validators: resolve(cwd, options.validators) } : {}),
      ...(options.context ? { context: options.context } : {}),
      ...(options.review ? { review: options.review } : {}),
    };
    const metadata = sessionOptionsMetadata(sessionSettings, cwd);
    const sessionEnv = runtime.workspaceEnvironment
      ? runtime.workspaceEnvironment(cwd)
      : { ...process.env, CTG_WORKSPACE: cwd };
    const promptText = await loadPromptContext(options, cwd);
    const { shouldFrame, framePrompt } = await import('../tui/framing.mjs');
    const framedPrompt = shouldFrame(promptText, { enabled: options.autoFraming !== false, delivery: options.delivery !== false })
      ? framePrompt(promptText) : promptText;
      const service = await ensure({ binary: options.engineCli });
      const model = modelWithThinking(providerModel(options), options.thinking);
      const signal = installSignalHandlers();
      let eventController;
      let eventReader = Promise.resolve();
      try {
        const client = await makeClient(service, cwd, runtimeRoot);
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
        if (framedPrompt) {
          if (!sessionID) {
            const created = await headlessApi.createSession(service, cwd, { body: {
              title: promptText.slice(0, 80),
              ...(model ? { model } : {}),
              metadata,
            } });
            sessionID = created.id;
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
        });
        const onSignal = () => child.kill('SIGINT');
        process.once('SIGINT', onSignal);
        try { return await childExit(child); } finally { process.removeListener('SIGINT', onSignal); }
      }
      let result;
      let headlessError;
      try {
        result = await headlessApi.runHeadless(service, cwd, framedPrompt || prompt || '', {
          sessionID: options.session,
          session: { title: promptText.slice(0, 80), ...(model ? { model } : {}), metadata },
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
          const preAdmission = latest.terminal === false;
          for (const event of nativeJsonEvents(preAdmission ? [] : nativeEvents, preAdmission ? undefined : sessionID, latest.messages || [], {
            outcome: latest.outcome || (!preAdmission ? latest.session?.outcome : undefined) || (headlessError ? signal.controller.signal.aborted ? 'interrupted' : 'failed' : undefined),
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
    const { client } = await serviceClient();
    const location = { directory: cwd };
    const listed = await client.integration.list({ location });
    const integrations = Array.isArray(listed?.data) ? listed.data : [];
    const target = args[0];
    const integration = target
      ? integrations.find(item => item.id === target || item.name.toLowerCase() === target.toLowerCase())
      : integrations.find(item => item.id === 'experiential-labs') || integrations.find(item => item.methods.some(method => method.type !== 'env'));
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
      const prompt = createInterface({ input: stdin, output: stdout });
      try {
        for (const field of method.form) {
          if (field.hidden) continue;
          const title = field.title || field.key;
          const value = await prompt.question(`${title}${field.required ? ' (required)' : ''}: `);
          if (!value && field.required) throw new Error(`${title} is required.`);
          if (value) answer[field.key] = field.type === 'boolean' ? value.toLowerCase() === 'true' : field.type === 'integer' || field.type === 'number' ? Number(value) : value;
        }
      } finally { prompt.close(); }
    }
    if (method.type === 'key') {
      throw new Error(`Key authentication for ${integration.name} is not prompted by the native CLI to avoid echoing secrets. Configure its documented API-key environment variable or use a supported OAuth method.`);
    }
    if (method.type === 'external') {
      await client.integration.connect.external({ integrationID: integration.id, methodID: method.id, answer, location });
      io.log(`Connected to ${integration.name}.`);
      return 0;
    }
    if (method.type !== 'oauth') throw new Error(`Authentication method ${method.type} is not supported by native CLI login.`);

    const controller = new AbortController();
    const onInterrupt = () => {
      const error = new Error('Login cancelled.');
      error.name = 'AbortError';
      error.code = 'SIGINT';
      controller.abort(error);
    };
    process.once('SIGINT', onInterrupt);
    let attempt;
    let completed = false;
    try {
      const started = await client.integration.oauth.connect({ integrationID: integration.id, methodID: method.id, answer, location }, { signal: controller.signal });
      attempt = started.data;
      io.log(attempt.instructions);
      io.log(attempt.url);
      const { openBrowser } = await import('../cloud/client.mjs');
      if (stdin?.isTTY && stdout?.isTTY) await openBrowser(attempt.url).catch(() => false);
      if (attempt.mode === 'code') {
        const prompt = createInterface({ input: stdin, output: stdout });
        let code;
        try { code = await prompt.question('Paste the authorization code: '); }
        finally { prompt.close(); }
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
          const finish = callback => value => {
            clearTimeout(timer);
            controller.signal.removeEventListener('abort', abort);
            callback(value);
          };
          const timer = setTimeout(finish(resolve), 500);
          const abort = () => finish(reject)(controller.signal.reason);
          controller.signal.addEventListener('abort', abort, { once: true });
          timer.unref?.();
        });
      }
      if (controller.signal.aborted) throw controller.signal.reason;
      throw new Error('Authorization expired.');
    } finally {
      process.removeListener('SIGINT', onInterrupt);
      if (attempt && !completed) await client.integration.oauth.cancel({ integrationID: integration.id, attemptID: attempt.attemptID, location }, { signal: AbortSignal.timeout(5_000) }).catch(() => {});
    }
  }

  async function shipCredential(client) {
    const result = await client.credential.list();
    const credentials = Array.isArray(result) ? result : result?.data || [];
    const ship = credentials.filter(entry => entry.integrationID === 'experiential-labs' && entry.active !== false);
    if (!ship.length) throw new Error('Carthagent Ship is not signed in. Native Ship credential resolution is not integrated yet; no secret is inferred from credential.list().');
    throw new Error('Carthagent Ship credentials are present, but the native provider connection does not expose a supported access-token API yet.');
  }

  async function cloudClient(accessToken) {
    const { CloudClient, cloudControlUrl, formatCloudAccount, formatNanoUsd, openBrowser, cloudManagedUsageRecovery } = await import('../cloud/client.mjs');
    return { client: new CloudClient({ baseUrl: cloudControlUrl() }), formatCloudAccount, formatNanoUsd, openBrowser, cloudManagedUsageRecovery, accessToken };
  }

  async function account() {
    const { client } = await serviceClient();
    const auth = await shipCredential(client);
    const cloud = await cloudClient(auth.token);
    let result;
    try { result = await cloud.client.account({ accessToken: cloud.accessToken }); }
    catch (error) { throw new Error(cloud.cloudManagedUsageRecovery(error) || `Carthagent Ship: ${error.message}`); }
    io.log(cloud.formatCloudAccount(result));
    for (const grant of result.grants || []) io.log(`  ${cloud.formatNanoUsd(grant.remainingNanoUsd)} remaining of ${cloud.formatNanoUsd(grant.originalNanoUsd)} · ${grant.source}${grant.expiresAt ? ` · expires ${grant.expiresAt}` : ''}`);
    for (const session of result.sessions || []) io.log(`  ${session.id} · ${session.revoked_at ? 'revoked' : 'active'} · ${session.client_name || 'Carthagent CLI'} · last used ${session.last_used_at || session.created_at}`);
    return 0;
  }

  async function billing({ action }) {
    const { client } = await serviceClient();
    const auth = await shipCredential(client);
    const cloud = await cloudClient(auth.token);
    let result;
    try {
      const cloudUrl = process.env.CARTHAGENT_CLOUD_URL || 'https://api.carthagent.xyz';
      const returnUrl = `${cloudUrl.replace(/\/+$/, '')}/account`;
      result = action === 'portal'
        ? await cloud.client.portal({ accessToken: cloud.accessToken, returnUrl })
        : await cloud.client.checkout({ accessToken: cloud.accessToken, successUrl: returnUrl, cancelUrl: returnUrl });
    } catch (error) { throw new Error(cloud.cloudManagedUsageRecovery(error) || `Carthagent Ship: ${error.message}`); }
    const opened = await cloud.openBrowser(result.url).catch(() => false);
    io.log(`${opened ? 'Opened' : 'Open'} ${result.url}`);
    return 0;
  }

  async function logout({ session: sessionID }) {
    const { client } = await serviceClient();
    const auth = await shipCredential(client);
    const cloud = await cloudClient(auth.token);
    if (sessionID) {
      await cloud.client.revokeSession({ accessToken: cloud.accessToken, sessionId: sessionID });
      io.log(`Revoked Ship session ${sessionID}.`);
    } else {
      await cloud.client.revokeCurrent({ accessToken: cloud.accessToken });
      if (auth.credential?.id) await client.credential.remove({ credentialID: auth.credential.id });
      io.log('Revoked current Carthagent Ship session.');
    }
    return 0;
  }

  async function review({ args }) {
    if (!args.length || args[0] === 'status') {
      const config = loadCarthagentConfig();
      io.log(`self-review default: ${resolveReviewMode(undefined, config)} (config: ${config.review ?? 'unset'} @ ${carthagentConfigPath()})`);
      return 0;
    }
    const mode = normalizeReviewMode(args[0]);
    if (mode) { saveCarthagentConfig({ review: mode }); io.log(`self-review default → ${mode} (saved to ${carthagentConfigPath()})`); return 0; }
    let reviewTask;
    if (args[0] === 'workspace') {
      const requestIndex = args.indexOf('--request-file');
      if (requestIndex < 0 || !args[requestIndex + 1]) throw Object.assign(new Error('Use ctg review workspace --request-file <original-task.txt>'), { exitCode: 2 });
      reviewTask = await readFile(resolve(cwd, args[requestIndex + 1]), 'utf8');
    }
    const { client } = await serviceClient();
    const { startReview, startPullRequestReview } = await import(join(runtimeRoot, 'lib/opencode/review.mjs'));
    const ctx = {
      session: {
        create: (input, options) => client.session.create({
          title: input.title,
          ...(input.agent ? { agent: input.agent } : {}),
          ...(input.model ? { model: input.model } : {}),
          location: input.location || { directory: cwd },
          ...(input.permissions ? { permissions: input.permissions } : {}),
        }, options),
        prompt: (input, options) => client.session.prompt({ sessionID: input.sessionID, text: reviewTask ? `${input.text}\n\nOriginal task to use as review criteria:\n${reviewTask}` : input.text }, options),
        wait: (input, options) => client.session.wait(input, options),
        context: (input, options) => client.session.context(input, options),
        get: (input, options) => client.session.get(input, options),
        interrupt: (input, options) => client.session.interrupt(input, options),
      },
      agent: { list: async (_input, options) => client.agent.list({ location: { directory: cwd } }, options) },
    };
    let timeoutMs = 300_000;
    const parsedArgs = [...args];
    for (let index = 0; index < parsedArgs.length; index++) {
      if (parsedArgs[index] === '--timeout') {
        const seconds = Number(parsedArgs[++index]);
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw Object.assign(new Error('Review timeout must be an integer from 1 to 300'), { exitCode: 2 });
        timeoutMs = seconds * 1000;
      }
    }
    const pr = parsedArgs.find((value, index) => !value.startsWith('-') && value !== 'workspace' && parsedArgs[index - 1] !== '--request-file' && parsedArgs[index - 1] !== '--timeout');
    if (args[0] === 'workspace') {
      const result = await startReview({ ctx, cwd, identity: `workspace:${cwd}`, timeoutMs });
      io.log(`VERDICT: ${result.verdict}`);
      return result.verdict === 'APPROVE' ? 0 : 1;
    }
    if (!pr) throw Object.assign(new Error('Review target is required'), { exitCode: 2 });
    if (/^(?:\d+|https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)/.test(pr)) {
      const view = await runCommand(['gh', 'pr', 'view', pr, '--json', 'url,number'], { cwd, timeoutSeconds: 30 });
      if (view.code !== 0) throw Object.assign(new Error(view.output.trim() || `Cannot load PR ${pr}; verify gh authentication and repository.`), { exitCode: 2 });
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
    const result = await startReview({ ctx, cwd, identity: `local:${cwd}`, timeoutMs });
    io.log(`VERDICT: ${result.verdict}`);
    return result.verdict === 'APPROVE' ? 0 : 1;
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
      throw new Error('The scripted ctg demo still depends on the legacy agent RPC protocol and is not available in the native CLI.');
    }
    if (command === 'test') return runCommand([process.execPath, '--test', 'tests/*.test.mjs'], { cwd: runtimeRoot, timeoutSeconds: 600 }).then(result => result.code);
    if (command === 'eval') return runCommand([process.execPath, join(runtimeRoot, 'evaluate.mjs'), ...args], { cwd: runtimeRoot, timeoutSeconds: 600 }).then(result => result.code);
    if (command === 'serve') {
      const child = spawn(process.execPath, [join(runtimeRoot, 'server.mjs')], { cwd: runtimeRoot, env: { ...process.env, CARTHAGENT_WORKSPACE: cwd }, stdio: 'inherit' });
      return childExit(child);
    }
    if (command === 'update') {
      const unknown = args.filter(value => !['--check', '--force'].includes(value));
      if (unknown.length || args.filter(value => value === '--check').length > 1 || args.filter(value => value === '--force').length > 1) throw Object.assign(new Error('Usage: ctg update [--check] [--force]'), { exitCode: 2 });
      const module = await import('../update.mjs');
      const latest = await module.fetchLatestRelease();
      const checkOnly = args.includes('--check');
      if (checkOnly) {
        io.log(`${latest.release.version} is available via ${latest.release.installSpec || latest.release.tag}.`);
        return 0;
      }
      const current = module.packageVersion() || '0.0.0';
      const delta = module.compareVersions(current, latest.release.version);
      if (delta === 0 && !args.includes('--force')) { io.log(`Carthagent ${current} is already up to date.`); return 0; }
      if (delta > 0 && !args.includes('--force')) { io.log(`Installed Carthagent ${current} is ahead of ${latest.release.version}; use --force to reinstall.`); return 0; }
      throw new Error('Native self-update cannot safely replace the active package-owned OpenCode runtime yet. Use `ctg update --check`; this command will not invoke a legacy installer or mutate the checkout.');
    }
    if (command === 'quit' || command === 'q' || command === 'exit') {
      if (args.length) throw Object.assign(new Error(`Usage: ctg ${command}`), { exitCode: 2 });
      io.log('There is no active native CLI session to quit.');
      return 0;
    }
    throw new Error(`Native command ${command} is not wired to a native implementation yet`);
  }

  return { run, listModels, login, account, billing, logout, review, domain, command };
}

export { hasHeadlessTerminal, headlessSucceeded, latestSessionForWorkspace, modelWithThinking, nativeJsonEvents, providerModel, reconcileHeadlessResult, textParts };
