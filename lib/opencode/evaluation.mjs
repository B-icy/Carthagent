import { OpenCode } from '@opencode/client';
import { createHash } from 'node:crypto';

export const NATIVE_EVALUATION_RUNTIME = 'opencode-2';
export const hashFile = bytes => createHash('sha256').update(bytes).digest('hex');

function positive(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isFinite(value) || value <= 0 || value > maximum) throw Error(`Invalid ${label}`);
  return value;
}
const assistantMessages = messages => messages.filter(message => message.type === 'assistant');

/** Run one native OpenCode session with fail-closed accounting and cancellation. */
export async function runNativeEvaluation({ directory, prompt, systemPrompt = '', model, provider, timeoutSeconds = 600, maxTurns = 100, maxCost = 3,
  signal, onEvent = () => {}, client, baseUrl = process.env.CTG_OPENCODE_URL, headers = {}, version = '2.0.32', outcomeTimeoutSeconds = 10 }) {
  positive(timeoutSeconds, 'timeoutSeconds', 3600);
  positive(maxTurns, 'maxTurns', 1000);
  positive(maxCost, 'maxCost');
  positive(outcomeTimeoutSeconds, 'outcomeTimeoutSeconds', 60);
  if (!directory || !prompt || !model || !provider) throw Error('directory, prompt, provider, and model are required');
  if (!client && !baseUrl) throw Error('CTG_OPENCODE_URL must identify the isolated native OpenCode service; shared service discovery is disabled.');
  const api = client || OpenCode.make({ baseUrl, headers });
  const controller = new AbortController();
  const eventController = new AbortController();
  const abort = () => controller.abort(signal?.reason || new Error('Evaluation stopped'));
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  controller.signal.addEventListener('abort', () => eventController.abort(), { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Evaluation wall-time limit')), timeoutSeconds * 1000);
  const started = Date.now();
  const state = { turns: 0, productiveTurns: 0, providerErrors: 0, cost: null, tokens: 0, tools: {}, errors: [], lastStop: null, budgetReason: null, deliveryStatus: null };
  let session, streamTask, streamError, outcome;
  let finished = false;
  let stopAfterIdle = false;
  const toolByCallID = new Map();

  const stop = reason => {
    if (state.budgetReason) return;
    state.budgetReason = reason;
    controller.abort(new Error(reason));
  };
  const onEventStream = async () => {
    try {
      for await (const event of api.event.subscribe({ signal: eventController.signal })) {
        if (finished) break;
        const data = event.data;
        // Native session events are scoped only by their typed data.sessionID.
        // Ignore missing IDs as well as neighbors; never infer scope from V1 fields.
        if (event.type.startsWith('session.') && data?.sessionID !== session.id) continue;
        if (event.type === 'session.step.ended') {
          const id = data.assistantMessageID;
          state.turns++;
          if (data.finish === 'error') state.providerErrors++;
          else state.productiveTurns++;
          state.lastStop = data.finish;
        } else if (event.type === 'session.execution.failed') {
          state.providerErrors++;
          state.errors.push(data.error?.message || 'OpenCode execution failed');
        } else if (event.type === 'session.tool.called') {
          toolByCallID.set(data.id, data);
          const name = data.tool || data.name;
          if (name) state.tools[name] = (state.tools[name] || 0) + 1;
        } else if (event.type === 'session.tool.success') {
          const call = toolByCallID.get(data.id);
          if (call?.tool === 'delivery_finish' || call?.name === 'delivery_finish') {
            const text = (data.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
            try { state.deliveryStatus = JSON.parse(text).status || null; } catch {}
          }
        } else if (event.type === 'session.tool.failed') {
          const call = toolByCallID.get(data.id);
          if (call?.tool === 'delivery_finish' || call?.name === 'delivery_finish') state.deliveryStatus = null;
        }
        onEvent(event);
        if (event.type === 'session.idle' && data.sessionID === session.id) {
          if (stopAfterIdle) break;
        }
      }
    } catch (error) {
      if (!eventController.signal.aborted) streamError = error;
    }
  };

  const pollOutcome = async () => {
    const deadline=Date.now()+outcomeTimeoutSeconds*1000;
    do {
      const info=await api.session.get({sessionID:session.id},{signal:AbortSignal.timeout(5000)});
      if(info.outcome) return info;
      if(Date.now()>=deadline) throw Error('OpenCode session terminal outcome did not become available');
      await new Promise(resolve=>setTimeout(resolve,25));
    } while(true);
  };

  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    const info = await api.server.info({ signal: controller.signal });
    if (info.version && !info.version.startsWith('2.')) throw Error(`OpenCode 2 required, received ${info.version}`);
    session = await api.session.create({
      model: { providerID: provider, id: model },
      location: { directory },
      title: `CTG evaluation ${NATIVE_EVALUATION_RUNTIME}`,
    }, { signal: controller.signal });
    streamTask = onEventStream();
    // Subscription has no replay; allow its connection to establish before admission.
    await new Promise(resolve => setTimeout(resolve, 50));
    if (controller.signal.aborted) throw controller.signal.reason;
    await api.session.prompt({ sessionID: session.id, text: `${systemPrompt ? `${systemPrompt}\n\n` : ''}${prompt}` }, { signal: controller.signal });
    await api.session.wait({ sessionID: session.id }, { signal: controller.signal });
    stopAfterIdle = true;
    if (streamTask) await Promise.race([streamTask, new Promise(resolve => setTimeout(resolve, 200))]);
    finished = true;
    eventController.abort(); // wait() is authoritative; snapshot below reconciles a missed idle.
    await streamTask;

    // wait() may beat durable projection updates. Poll this exact session until its
    // authoritative terminal outcome is visible; absence is never success.
    const sessionInfo = await pollOutcome();
    outcome = sessionInfo.outcome;
    if (outcome !== 'succeeded') state.errors.push(`OpenCode session ended with authoritative outcome: ${outcome}`);

    // Fetch only this session's assistant transcript; /session/stats is project-wide.
    const transcript = await api.session.context({ sessionID: session.id }, { signal: AbortSignal.timeout(5000) });
    const assistant = assistantMessages(transcript);
    state.turns = assistant.filter(message => message.finish !== undefined).length;
    state.productiveTurns = assistant.filter(message => message.finish !== undefined && message.finish !== 'error').length;
    state.providerErrors = Math.max(state.providerErrors, assistant.filter(message => message.finish === 'error').length);
    state.lastStop = assistant.at(-1)?.finish || null;
    state.tools = {};
    for (const message of assistant) for (const part of message.content || []) {
      if (part.type === 'tool') state.tools[part.name] = (state.tools[part.name] || 0) + 1;
      if (part.type === 'tool' && part.name === 'delivery_finish' && part.state?.status === 'completed') {
        const text=(part.state.content || []).filter(item=>item.type==='text').map(item=>item.text).join('\n');
        try { state.deliveryStatus=JSON.parse(text).status || null; } catch {}
      }
    }
    const tokenUsage = sessionInfo.tokens;
    if (!Number.isFinite(sessionInfo.cost) || sessionInfo.cost < 0 || !tokenUsage || !['input','output','reasoning'].every(key => Number.isFinite(tokenUsage[key]) && tokenUsage[key] >= 0) || !tokenUsage.cache || !['read','write'].every(key => Number.isFinite(tokenUsage.cache[key]) && tokenUsage.cache[key] >= 0)) {
      throw Error('OpenCode session aggregate usage is unavailable; refusing evaluation without enforceable max-cost');
    }
    state.cost = sessionInfo.cost;
    state.tokens = tokenUsage.input + tokenUsage.output + tokenUsage.reasoning + tokenUsage.cache.read + tokenUsage.cache.write;
    if (state.cost >= maxCost) state.budgetReason = 'reported cost limit';
    if (state.productiveTurns > maxTurns) state.budgetReason = 'productive model turn limit exceeded';
    if (outcome !== 'succeeded' && !state.budgetReason) {
      state.budgetReason = `session ${outcome}`;
    }
    if (!state.budgetReason && (state.turns !== state.productiveTurns + state.providerErrors)) {
      state.budgetReason = 'incomplete turn accounting';
      state.errors.push('Transcript did not reconcile all completed assistant turns.');
    }
  } catch (error) {
    if (!state.budgetReason) {
      if (controller.signal.aborted && Date.now() - started >= timeoutSeconds * 1000) state.budgetReason = 'wall-time limit';
      else if (controller.signal.aborted && signal?.aborted && /wall.?time/i.test(String(signal.reason?.message || signal.reason || ''))) state.budgetReason = 'wall-time limit';
      else if (controller.signal.aborted && signal?.aborted) state.budgetReason = 'cancelled';
      else state.budgetReason = 'native OpenCode request failed';
    }
    state.errors.push(error instanceof Error ? error.message : String(error));
    if (session && !outcome && !controller.signal.aborted) {
      try {
        await api.session.wait({ sessionID:session.id }, { signal:AbortSignal.timeout(outcomeTimeoutSeconds * 1000) });
        const info=await pollOutcome();
        outcome=info.outcome;
      } catch {}
    }
    if (session && !controller.signal.aborted) {
      try {
        const info=await api.session.get({sessionID:session.id},{signal:AbortSignal.timeout(5000)});
        if(Number.isFinite(info.cost) && info.cost >= 0) state.cost=info.cost;
        const usage=info.tokens;
        if(usage && ['input','output','reasoning'].every(key=>Number.isFinite(usage[key])) && usage.cache && Number.isFinite(usage.cache.read) && Number.isFinite(usage.cache.write)) {
          state.tokens=usage.input+usage.output+usage.reasoning+usage.cache.read+usage.cache.write;
        }
      } catch {}
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    finished = true;
    eventController.abort();
    if (session && controller.signal.aborted) await api.session.interrupt({ sessionID: session.id }).catch(() => {});
    await streamTask?.catch(() => {});
  }
  if (!outcome && !state.budgetReason) {
    state.budgetReason = 'missing terminal session outcome';
    state.errors.push('OpenCode session has no authoritative terminal outcome.');
  }
  return { ...state, outcome: outcome || null, exitCode: state.budgetReason || streamError ? 1 : 0, timedOut: state.budgetReason === 'wall-time limit', durationMs: Date.now() - started, sessionID: session?.id || null, runtime: NATIVE_EVALUATION_RUNTIME, opencodeVersion: version };
}
