import { Plugin } from '@opencode/plugin';

type Turn = { id: string; finish: string; productive: boolean };
const ledgerKey = (sessionID: string) => `evaluation/${sessionID}/turns`;
const budgetKey = 'ctg.evaluation.budget';
const retryKey = (sessionID: string) => `evaluation/${sessionID}/retries`;

/** Durable per-session admission boundary for productive OpenCode model requests. */
export default Plugin.define({
  id: 'ctg.evaluation-budget',
  async setup(ctx) {
    const maxTurns = Number(process.env.CTG_EVALUATION_MAX_TURNS);
    const maxCost = Number(process.env.CTG_EVALUATION_MAX_COST);
    const maxRetries = Number(process.env.CTG_EVALUATION_MAX_RETRIES ?? 8);
    if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 1000) throw Error('Invalid evaluation turn limit');
    if (!Number.isFinite(maxCost) || maxCost <= 0) throw Error('Invalid evaluation cost limit');
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 100) throw Error('Invalid evaluation retry limit');

    // Durable, ID-keyed session events populate the persistent ledger. The
    // storage ledger survives compaction and service restarts; message IDs make
    // repeated delivery idempotent and prevent double-counting completed turns.
    const turnsBySession = new Map<string, Map<string, Turn>>();
    const eventAbort = new AbortController();
    const pendingWrites = new Map<string, Promise<void>>();
    const retriesBySession = new Map<string, number>();
    const eventTask = (async () => {
      for await (const event of ctx.event.subscribe({ signal: eventAbort.signal })) {
        if (!event.type.startsWith('session.') || !('sessionID' in event.data)) continue;
        const sessionID = event.data.sessionID;
        if (event.type === 'session.step.ended' || event.type === 'session.step.failed') {
          const messageID = event.data.assistantMessageID;
          const turns = await loadTurns(sessionID);
          const failed = event.type === 'session.step.failed' || event.data.finish === 'error';
          turns.set(messageID, { id: messageID, finish: failed ? 'error' : event.data.finish ?? 'error', productive: !failed });
          await saveTurns(sessionID, turns);
        } else if (event.type === 'session.execution.failed') {
          // Retry exhaustion can terminate an execution without a final step event.
          // It does not count as productive work, but remains separately bounded.
          await ctx.storage.set(retryKey(sessionID), retriesBySession.get(sessionID) ?? 0);
        } else if (event.type === 'session.compaction.ended') {
          const transcript = await ctx.session.context({ sessionID });
          const turns = await loadTurns(sessionID);
          for (const message of transcript) {
            if (message.type !== 'assistant' || !message.finish) continue;
            if (message.finish === 'error') turns.set(message.id, { id: message.id, finish: 'error', productive: false });
            else turns.set(message.id, { id: message.id, finish: message.finish, productive: true });
          }
          await saveTurns(sessionID, turns);
        }
      }
    })();
    // Async iteration normally exits when cleanup aborts its subscription. Keep a
    // terminal rejection observed so it cannot become an unhandled plugin error.
    void eventTask.catch(() => undefined);

    async function loadTurns(sessionID: string) {
      await pendingWrites.get(sessionID);
      const turns = new Map<string, Turn>();
      const persisted = await ctx.storage.get(ledgerKey(sessionID));
      if (Array.isArray(persisted)) {
        for (const item of persisted) {
          if (item && typeof item === 'object' && 'id' in item && 'finish' in item && 'productive' in item
            && typeof item.id === 'string' && typeof item.finish === 'string' && typeof item.productive === 'boolean') turns.set(item.id, item as Turn);
        }
      }
      for (const [id, turn] of turnsBySession.get(sessionID) ?? []) turns.set(id, turn);
      turnsBySession.set(sessionID, turns);
      return turns;
    }

    async function saveTurns(sessionID: string, turns: Map<string, Turn>) {
      const before = pendingWrites.get(sessionID) ?? Promise.resolve();
      const write = before.catch(() => undefined).then(() => ctx.storage.set(ledgerKey(sessionID), [...turns.values()]));
      pendingWrites.set(sessionID, write);
      try { await write; }
      finally { if (pendingWrites.get(sessionID) === write) pendingWrites.delete(sessionID); }
    }

    let modelRequest;
    let retry;
    try {
      modelRequest = await ctx.session.hook('model.request', async event => {
        if (event.kind !== 'primary') return;
        await pendingWrites.get(event.sessionID);
        const session = await ctx.session.get({ sessionID: event.sessionID });
        const configured = session.metadata?.[budgetKey];
        if (!configured || typeof configured !== 'object'
          || configured.maxTurns !== maxTurns || configured.maxCost !== maxCost) {
          throw Error('Evaluation session budget handshake is missing or differs from the active admission guard');
        }
        const turns = await loadTurns(event.sessionID);
        // Reconcile the host's durable session projection before every admission.
        // The storage ledger retains pre-compaction IDs; context contributes any
        // completed assistant turns written before a service/plugin restart.
        const transcript = await ctx.session.context({ sessionID:event.sessionID });
        for (const message of transcript) {
          if (message.type !== 'assistant' || !message.finish) continue;
          // A retained compacted summary is a new assistant message, but never
          // an admitted model request; only IDs seen in durable step events count.
          if (message.metadata?.synthetic === true || message.content?.some(part => part.type === 'compaction')) continue;
          turns.set(message.id, { id:message.id, finish:message.finish, productive:message.finish !== 'error' });
        }
        await saveTurns(event.sessionID, turns);
        const usedTurns = [...turns.values()].filter(turn => turn.productive).length;
        if (usedTurns >= maxTurns) throw Error('Evaluation productive model-turn budget exhausted before request admission');

        const info = session;
        const model = (await ctx.model.list({ location: { directory: ctx.location.directory } })).data
          .find(candidate => candidate.providerID === event.model.providerID && candidate.id === event.model.id);
        const rates = model?.cost;
        if (!Number.isFinite(info.cost) || !rates?.length || !Number.isFinite(model?.limit?.context) || !Number.isFinite(model?.limit?.output)) {
          throw Error('Evaluation usage or model pricing limits unavailable; refusing request admission');
        }
        const maxInputRate = Math.max(...rates.map(rate => rate.input), ...rates.map(rate => rate.cache.read));
        const maxOutputRate = Math.max(...rates.map(rate => rate.output), ...rates.map(rate => rate.cache.write));
        const worstCaseCost = (model.limit.context * maxInputRate + model.limit.output * maxOutputRate) / 1_000_000;
        if (!Number.isFinite(worstCaseCost) || info.cost + worstCaseCost > maxCost) throw Error('Evaluation cost budget exhausted before request admission');
      });
      retry = await ctx.session.hook('retry', async event => {
        if (event.attempt >= maxRetries) {
          event.decision = { retry: false };
          return;
        }
        const persisted = await ctx.storage.get(retryKey(event.sessionID));
        const total = Math.max(retriesBySession.get(event.sessionID) ?? 0, typeof persisted === 'number' ? persisted : 0) + 1;
        retriesBySession.set(event.sessionID, total);
        await ctx.storage.set(retryKey(event.sessionID), total);
        if (total > maxRetries) event.decision = { retry: false };
      });
    } catch (error) {
      eventAbort.abort();
      await retry?.dispose();
      await modelRequest?.dispose();
      throw error;
    }
    return async () => {
      try { await retry.dispose(); }
      finally {
        try { await modelRequest.dispose(); }
        finally {
          eventAbort.abort();
          await eventTask.catch(() => undefined);
        }
      }
    };
  },
});
