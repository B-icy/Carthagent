import { reviewKickoff } from "../../../../lib/review.mjs";
import { resolveReviewMode } from "../../../../lib/review.mjs";
import { SESSION_OPTIONS_KEY } from "../../../../lib/opencode/session-options.mjs";

/** Send the PR ↔ fresh-review ↔ fixes instruction to the working session. */
export async function sendNativeReviewKickoff({ client, sessionID, signal, prompt = reviewKickoff() }) {
  await client.session.prompt({ sessionID, text: prompt, metadata: { "ctg.raw": true } }, { signal });
}

/** Explicit launch mode persisted for the session wins over the profile default. */
export function nativeReviewMode(session, config, explicitMode) {
  return resolveReviewMode(explicitMode ?? session?.metadata?.[SESSION_OPTIONS_KEY]?.review, config);
}

/** Correlate host executions and admit one current-run kickoff per session. */
/** @param {{ mode: (sessionID: string) => string, diff: (sessionID: string, signal?: AbortSignal) => Promise<unknown>, offer: (value: { sessionID: string; runKey: string; writes: number; start: () => Promise<boolean> }) => Promise<unknown>, kickoff: (sessionID: string, signal?: AbortSignal) => Promise<unknown>, isLoopActive?: (sessionID: string) => boolean, setLoopActive?: (sessionID: string, active: boolean) => void, signal?: AbortSignal }} options */
export function createNativeReviewConsumer({ mode, diff, offer, kickoff, isLoopActive = () => false, setLoopActive = () => {}, signal }) {
  const runs = new Map();
  const admitted = new Set();
  const pending = new Set();
  const loopSessions = new Set();
  let sequence = 0;
  let disposed = false;

  async function finish(sessionID, succeeded) {
    const run = runs.get(sessionID);
    if (!run || run.finished || disposed) return;
    run.finished = true;
    if (!succeeded || signal?.aborted || loopSessions.has(sessionID) || isLoopActive(sessionID)) return;

    let baseline;
    try { baseline = await run.baseline; }
    catch { return; }
    if (disposed || signal?.aborted || runs.get(sessionID) !== run) return;
    let changes;
    try { changes = await diff(sessionID, signal); }
    catch { return; }
    if (disposed || signal?.aborted || runs.get(sessionID) !== run) return;
    if (!Array.isArray(changes) || !Array.isArray(baseline)) return;
    const before = new Map(baseline.map((file) => [file.file, `${file.status}\0${file.patch}`]));
    const writes = changes.filter((file) => file && (file.additions > 0 || file.deletions > 0 || file.status === "added" || file.status === "deleted") && before.get(file.file) !== `${file.status}\0${file.patch}`).length;
    const runKey = `${sessionID}@${run.id}`;
    const currentMode = mode(sessionID);
    if (!(currentMode === "ask" || currentMode === "yes") || writes <= 0 || admitted.has(runKey) || (currentMode === "yes" && loopSessions.has(sessionID))) return;
    admitted.add(runKey);

    const start = async () => {
      if (disposed || signal?.aborted || runs.get(sessionID) !== run || pending.has(sessionID) || loopSessions.has(sessionID) || isLoopActive(sessionID)) return false;
      pending.add(sessionID);
      loopSessions.add(sessionID);
      setLoopActive(sessionID, true);
      try {
        await kickoff(sessionID, signal);
        return true;
      } catch (error) {
        loopSessions.delete(sessionID);
        setLoopActive(sessionID, false);
        throw error;
      } finally {
        pending.delete(sessionID);
      }
    };

    if (currentMode === "yes") {
      await start();
      return;
    }
    let offered = false;
    await offer({ sessionID, runKey, writes, start: async () => {
      if (offered) return false;
      offered = true;
      if (runs.get(sessionID) !== run) return false;
      return start();
    } });
  }

  return {
    onPromptSubmitted(sessionID) {
      if (sessionID && loopSessions.delete(sessionID)) setLoopActive(sessionID, false);
    },
    setLoopActive(sessionID, active) {
      if (!sessionID) return;
      if (active) loopSessions.add(sessionID);
      else loopSessions.delete(sessionID);
      setLoopActive(sessionID, active);
    },
    onStarted(event) {
      const sessionID = event?.data?.sessionID;
      if (!sessionID || disposed) return;
      const id = event.id ?? `${event.created ?? Date.now()}-${++sequence}`;
      // A rejection is handled here, not left as an unhandled promise if the run fails.
      const baseline = Promise.resolve().then(() => diff(sessionID, signal)).catch(() => undefined);
      runs.set(sessionID, { id, baseline, finished: false });
    },
    onSucceeded(event) { return finish(event?.data?.sessionID, true); },
    onFailed(event) { return finish(event?.data?.sessionID, false); },
    onInterrupted(event) { return finish(event?.data?.sessionID, false); },
    dispose() { disposed = true; runs.clear(); pending.clear(); },
  };
}

/** Wire host execution lifecycle; returned disposers belong to plugin setup. */
export function subscribeNativeReviewEvents(data, consumer, onError = (_error) => {}) {
  return [
    data.on("session.execution.started", (event) => consumer.onStarted(event)),
    data.on("session.execution.succeeded", (event) => { void consumer.onSucceeded(event).catch(onError); }),
    data.on("session.execution.failed", (event) => { void consumer.onFailed(event).catch(onError); }),
    data.on("session.execution.interrupted", (event) => { void consumer.onInterrupted(event).catch(onError); }),
  ];
}
