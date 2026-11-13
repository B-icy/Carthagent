import { resolve } from 'node:path';
import type { Context } from '@opencode/plugin/promise/plugin';
import type { Tool } from '@opencode/schema/tool';
import { applyGoalUpdate, continuationText, goalSystemText, newGoal, onTurnEnd, readGoal, resumeGoal } from '../session-goal.mjs';
import { SessionGoals, type SessionGoal } from '../session-goal-rpc';
import { localToolName } from './ship-context.mjs';

type Port = Pick<Context, 'storage' | 'session' | 'event' | 'tool' | 'rpc' | 'location'>;
type Outcome = 'succeeded' | 'failed' | 'interrupted';
const key = (sessionID: string) => `goal/${sessionID}`;
export const GOAL_TOOL = 'goal_update';

/**
 * The /goal engine, independent of registration so tests can drive it.
 * `prompt` sends a continuation turn; `changed` reports state to the TUI.
 */
export function createSessionGoals(ctx: Pick<Context, 'storage'>, options: { prompt: (sessionID: string, text: string, continuation: boolean) => Promise<unknown>; changed?: (sessionID: string, goal: SessionGoal | null) => void; now?: () => number }) {
  const now = options.now ?? Date.now;
  const queues = new Map<string, Promise<unknown>>();
  const serial = <T>(sessionID: string, work: () => Promise<T>): Promise<T> => {
    const next = (queues.get(sessionID) ?? Promise.resolve()).then(work, work);
    queues.set(sessionID, next.catch(() => {}));
    return next;
  };
  const get = async (sessionID: string): Promise<SessionGoal | undefined> => readGoal(await ctx.storage.get(key(sessionID))) as SessionGoal | undefined;
  const save = async (sessionID: string, goal: SessionGoal | undefined) => {
    if (goal) await ctx.storage.set(key(sessionID), goal as never); else await ctx.storage.remove(key(sessionID));
    options.changed?.(sessionID, goal ?? null);
    return goal ?? null;
  };
  return {
    get: (sessionID: string) => get(sessionID),
    /** Set (or replace) the goal and start working on it now. */
    set: (sessionID: string, objective: string, maxTurns: number) => serial(sessionID, async () => {
      const goal = newGoal(objective, maxTurns, now()) as SessionGoal;
      await save(sessionID, goal);
      await options.prompt(sessionID, `Goal: ${objective}`, false);
      return goal;
    }),
    clear: (sessionID: string) => serial(sessionID, async () => { await save(sessionID, undefined); return null; }),
    resume: (sessionID: string) => serial(sessionID, async () => {
      const goal = resumeGoal(await get(sessionID)) as SessionGoal;
      await save(sessionID, goal);
      await options.prompt(sessionID, continuationText(goal), true);
      return goal;
    }),
    /** Called by the model through goal_update. */
    update: (sessionID: string, input: unknown) => serial(sessionID, async () => save(sessionID, applyGoalUpdate(await get(sessionID), input, now()) as SessionGoal)),
    /** A turn ended: continue, pause, or do nothing. */
    turnEnded: (sessionID: string, outcome: Outcome) => serial(sessionID, async () => {
      const current = await get(sessionID);
      const next = onTurnEnd(current, outcome);
      if (next.action === 'none') return next.action;
      await save(sessionID, next.goal as SessionGoal);
      if (next.action === 'continue') await options.prompt(sessionID, continuationText(next.goal), true);
      return next.action;
    }),
    systemText: async (sessionID: string) => { const goal = await get(sessionID); return goal?.status === 'active' ? goalSystemText(goal) : undefined; },
  };
}

export async function registerSessionGoals(ctx: Port) {
  const cleanups: Array<() => unknown> = [];
  let emit: ((sessionID: string, goal: SessionGoal | null) => void) | undefined;
  const goals = createSessionGoals(ctx, {
    // Queue behind anything the user already sent; a goal never interrupts them.
    // Continuations are not new tasks: skip Ship's task framing (as /raw does).
    prompt: (sessionID, text, continuation) => ctx.session.prompt({ sessionID, text, delivery: 'queue', metadata: { 'ctg.goal': true, ...(continuation ? { 'ctg.raw': true } : {}) } }),
    changed: (sessionID, goal) => emit?.(sessionID, goal),
  });
  try {
    const tools = await ctx.tool.transform(editor => {
      editor.namespace?.({ name: 'carthagent', description: 'Carthagent session tools' });
      editor.add({
        name: GOAL_TOOL,
        description: 'Report the session /goal as done (achieved and checked) or blocked (needs the user). Only available while a /goal is active.',
        input: { type: 'object', additionalProperties: false, required: ['status', 'summary'], properties: { status: { type: 'string', enum: ['done', 'blocked'] }, summary: { type: 'string', minLength: 1, maxLength: 2000 } } } as Tool.ValueSchema<{ status: string; summary: string }>,
        // Direct tool only: the per-turn hide below cannot reach the code tool's catalog.
        options: { namespace: 'carthagent', codemode: false },
        execute: async (input, tool) => {
          const goal = await goals.update(tool.sessionID, input);
          return { content: goal?.status === 'done' ? 'Goal marked done. Stop here and give the user the summary.' : 'Goal marked blocked. Stop here and tell the user exactly what you need.' };
        },
      });
    });
    cleanups.push(() => tools.dispose());
    const context = await ctx.session.hook('context', async event => {
      const text = await goals.systemText(event.sessionID);
      if (text) { if (Array.isArray(event.system)) event.system.push({ type: 'text', text }); return; }
      if (event.tools) for (const name of Object.keys(event.tools)) if (localToolName(name) === GOAL_TOOL) delete event.tools[name];
    });
    cleanups.push(() => context.dispose());
    const registration = await ctx.rpc.register(SessionGoals, {
      get: async (input: unknown) => ({ goal: (await goals.get((input as { sessionID: string }).sessionID)) ?? null }),
      set: async (input: unknown, call: { error: (name: 'goalError', message: string, data: { message: string }) => never }) => {
        const { sessionID, objective, maxTurns } = input as { sessionID: string; objective: string; maxTurns: number };
        try { return { goal: await goals.set(sessionID, objective, maxTurns) }; }
        catch (error) { const message = error instanceof Error ? error.message : String(error); return call.error('goalError', message, { message }); }
      },
      clear: async (input: unknown) => ({ goal: await goals.clear((input as { sessionID: string }).sessionID) }),
      resume: async (input: unknown, call: { error: (name: 'goalError', message: string, data: { message: string }) => never }) => {
        try { return { goal: await goals.resume((input as { sessionID: string }).sessionID) }; }
        catch (error) { const message = error instanceof Error ? error.message : String(error); return call.error('goalError', message, { message }); }
      },
    } as never);
    cleanups.push(() => registration.dispose());
    emit = (sessionID, goal) => { void registration.events.emit('changed', { sessionID, goal } as never).catch(() => {}); };
    const here = resolve(ctx.location.directory);
    const ownsSession = async (sessionID: string) => {
      try { return resolve((await ctx.session.get({ sessionID })).location.directory) === here; } catch { return false; }
    };
    const abort = new AbortController();
    cleanups.push(() => abort.abort());
    const outcomes: Record<string, Outcome> = { 'session.execution.succeeded': 'succeeded', 'session.execution.failed': 'failed', 'session.execution.interrupted': 'interrupted' };
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
          const outcome = outcomes[event.type];
          const sessionID = (event as { data?: { sessionID?: string } }).data?.sessionID;
          if (!outcome || !sessionID) continue;
          // The service loads one plugin instance per workspace location and every
          // instance sees every session event; only the session's own location may
          // continue it, or each instance would queue its own continuation.
          if (!(await ownsSession(sessionID))) continue;
          await goals.turnEnded(sessionID, outcome).catch(() => {});
        }
      } catch { /* Disposal aborts the stream. */ }
    })();
  } catch (error) {
    for (const cleanup of cleanups.reverse()) await cleanup();
    throw error;
  }
  return async () => { emit = undefined; for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); };
}
