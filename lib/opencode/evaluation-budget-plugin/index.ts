import { Plugin } from '@opencode/plugin';

/** Per-session admission boundary for productive OpenCode model requests. */
export default Plugin.define({
  id: 'ctg.evaluation-budget',
  setup(ctx) {
    const maxTurns = Number(process.env.CTG_EVALUATION_MAX_TURNS);
    const maxCost = Number(process.env.CTG_EVALUATION_MAX_COST);
    if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 1000) throw Error('Invalid evaluation turn limit');
    if (!Number.isFinite(maxCost) || maxCost <= 0) throw Error('Invalid evaluation cost limit');
    const turns = new Map<string, number>();
    ctx.session.hook('model.request', async event => {
      if (event.kind !== 'primary') return;
      const usedTurns = turns.get(event.sessionID) || 0;
      if (usedTurns >= maxTurns) throw Error('Evaluation productive model-turn budget exhausted before request admission');
      turns.set(event.sessionID, usedTurns + 1);
      try {
        const info = await ctx.session.get({ sessionID: event.sessionID });
        if (!Number.isFinite(info.cost) || info.cost >= maxCost) throw Error('Evaluation cost budget exhausted before request admission');
      } catch (error) {
        turns.set(event.sessionID, usedTurns);
        throw error;
      }
    });
  },
});
