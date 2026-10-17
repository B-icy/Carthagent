import { Plugin } from '@opencode/plugin';

/** Per-session admission boundary for productive OpenCode model requests. */
export default Plugin.define({
  id: 'ctg.evaluation-budget',
  async setup(ctx) {
    const maxTurns = Number(process.env.CTG_EVALUATION_MAX_TURNS);
    const maxCost = Number(process.env.CTG_EVALUATION_MAX_COST);
    if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 1000) throw Error('Invalid evaluation turn limit');
    if (!Number.isFinite(maxCost) || maxCost <= 0) throw Error('Invalid evaluation cost limit');
    const registration = await ctx.session.hook('model.request', async event => {
      if (event.kind !== 'primary') return;
      const transcript = await ctx.session.context({ sessionID: event.sessionID });
      const usedTurns = transcript.filter(message => message.type === 'assistant' && message.finish !== undefined && message.finish !== 'error').length;
      if (usedTurns >= maxTurns) throw Error('Evaluation productive model-turn budget exhausted before request admission');
      const info = await ctx.session.get({ sessionID: event.sessionID });
      const model = (await ctx.model.list({ location: { directory: ctx.location.directory } })).data
        .find(candidate => candidate.providerID === event.model.providerID && candidate.id === event.model.id);
      const rates = model?.cost;
      if (!Number.isFinite(info.cost) || !rates?.length || !Number.isFinite(model?.limit?.context) || !Number.isFinite(model?.limit?.output)) {
        throw Error('Evaluation usage or model pricing limits unavailable; refusing request admission');
      }
      // Reserve the worst advertised input/output rate over the model's full
      // context and output limits. Session aggregate is reconciled after every
      // completed turn; this conservative upper bound prevents one admitted
      // request from crossing the configured cost ceiling.
      const maxInputRate = Math.max(...rates.map(rate => rate.input), ...rates.map(rate => rate.cache.read));
      const maxOutputRate = Math.max(...rates.map(rate => rate.output), ...rates.map(rate => rate.cache.write));
      const worstCaseCost = (model.limit.context * maxInputRate + model.limit.output * maxOutputRate) / 1_000_000;
      if (!Number.isFinite(worstCaseCost) || info.cost + worstCaseCost > maxCost) throw Error('Evaluation cost budget exhausted before request admission');
    });
    let retry;
    try {
      retry = await ctx.session.hook('retry', async event => {
        // Retries are not productive turns, but remain independently bounded so
        // repeated provider failures cannot evade the turn ceiling indefinitely.
        if (event.attempt >= maxTurns) event.decision = { retry: false };
      });
    } catch (error) {
      await registration.dispose();
      throw error;
    }
    return async () => {
      try { await retry.dispose(); }
      finally { await registration.dispose(); }
    };
  },
});
