import type { Context } from '@opencode/plugin/promise/plugin';
import { framePrompt, shouldFrame, unframe } from '../../../../lib/tui/framing.mjs';
import { SessionControls } from '../session-rpc';
import { effectiveSessionOptions } from '../../../../lib/opencode/session-options.mjs';

/** Admission framing is session-scoped; raw bypasses framing, never delivery policy. */
export async function registerSessionControls(ctx: Context) {
  const cleanups: Array<() => Promise<void>> = [];
  const pending = new Map<string, Promise<unknown>>();
  const exclusive = async <T>(sessionID: string, action: () => Promise<T>): Promise<T> => {
    const before = pending.get(sessionID) ?? Promise.resolve();
    const current = before.catch(() => undefined).then(action);
    pending.set(sessionID, current);
    try { return await current; }
    finally { if (pending.get(sessionID) === current) pending.delete(sessionID); }
  };
  const key = (sessionID: string) => `controls/${sessionID}`;
  const settings = async (sessionID: string) => {
    const value = await ctx.storage.get(key(sessionID));
    if (value && typeof value === 'object' && 'framing' in value) return { framing: value.framing !== false };
    const session = await ctx.session.get({ sessionID });
    return { framing: effectiveSessionOptions(session, ctx.options).guide };
  };
  try {
    const prompt = await ctx.session.hook('prompt', async (event) => {
      const session = await ctx.session.get({ sessionID: event.sessionID });
      const options = effectiveSessionOptions(session, ctx.options);
      const saved = await settings(event.sessionID);
      if (event.metadata?.['ctg.raw'] === true || event.metadata?.['ctg.framed'] === true) return;
      if (!shouldFrame(event.prompt.text, {
        enabled: saved.framing,
        delivery: options.delivery,
      }) || unframe(event.prompt.text) !== null) return;
      const original = event.prompt.text;
      const framed = framePrompt(original);
      // Mentions refer to offsets in the original text. Drop only their display
      // ranges after rewriting; keep resolved files/agents/skills attached.
      for (const entries of [event.prompt.files, event.prompt.agents, event.prompt.skills]) {
        for (const entry of entries ?? []) delete entry.mention;
      }
      event.prompt.text = framed;
      event.metadata = { ...event.metadata, 'ctg.framed': true, 'ctg.original': original };
    });
    cleanups.push(() => prompt.dispose());
    const registration = await ctx.rpc.register(SessionControls, {
      framing: async (input, call) => {
        const { sessionID, enabled } = input as { sessionID: string; enabled?: boolean };
        return exclusive(sessionID, async () => {
          call.signal.throwIfAborted();
          const session = await ctx.session.get({ sessionID }, { signal: call.signal });
          if (session.location.directory !== ctx.location.directory) return call.error('wrong_workspace', 'Session belongs to another workspace location', { sessionID });
          const saved = await settings(sessionID);
          const next = enabled ?? !saved.framing;
          await ctx.storage.set(key(sessionID), { ...saved, framing: next });
          return { enabled: next };
        });
      },
      compact: async (input, call) => {
        const { sessionID, notes } = input as { sessionID: string; notes?: string };
        return exclusive(sessionID, async () => {
          call.signal.throwIfAborted();
          const session = await ctx.session.get({ sessionID }, { signal: call.signal });
          if (session.location.directory !== ctx.location.directory) return call.error('wrong_workspace', 'Session belongs to another workspace location', { sessionID });
          // The native compact API has no notes field. Queue a durable control
          // message before it so notes survive disconnect and cannot leak to a
          // different session through a process-global one-shot hook.
          if (notes) await ctx.session.synthetic({
            sessionID, delivery: 'queue', description: 'User compaction instructions',
            text: `User instructions for the next context summary:\n${notes}`,
          }, { signal: call.signal });
          await ctx.session.compact({ sessionID, delivery: 'queue' }, { signal: call.signal });
          return { admitted: true };
        });
      },
    });
    cleanups.push(() => registration.dispose());
  } catch (error) {
    await Promise.allSettled(cleanups.reverse().map((dispose) => dispose()));
    throw error;
  }
  return async () => { for (const dispose of cleanups.reverse()) await dispose(); };
}
