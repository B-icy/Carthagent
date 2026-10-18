/** Correlate host execution events and admit at most one native review per run. */
export function createNativeReviewConsumer({ mode, diff, offer, startReview, isLoopActive = () => false }) {
  const runs = new Map();
  const admitted = new Set();
  const pending = new Map();
  const reviewSessions = new Set();

  async function finish(sessionID, succeeded) {
    const run = runs.get(sessionID);
    if (!run || run.finished || reviewSessions.has(sessionID) || pending.has(sessionID)) return;
    run.finished = true;
    if (!succeeded) return;

    let baseline;
    try { baseline = await run.baseline; }
    catch { return; }
    let changes;
    try { changes = await diff(sessionID); }
    catch { return; }
    if (!Array.isArray(changes) || !Array.isArray(baseline)) return;
    const before = new Map(baseline.map((file) => [file.file, `${file.status}\0${file.patch}`]));
    const writes = changes.filter((file) => file && (file.additions > 0 || file.deletions > 0 || file.status === "added" || file.status === "deleted") && before.get(file.file) !== `${file.status}\0${file.patch}`).length;
    const runKey = `${sessionID}@${run.id}`;
    const currentMode = mode();
    if (!(["ask", "yes"].includes(currentMode) && writes > 0) || isLoopActive() || admitted.has(runKey)) return;

    admitted.add(runKey);
    if (admitted.size > 200) admitted.clear();
    if (currentMode === "yes") {
      pending.set(sessionID, runKey);
      try {
        const spawned = await startReview(sessionID);
        if (spawned) reviewSessions.add(spawned);
      }
      finally { pending.delete(sessionID); }
      return;
    }
    await offer({ sessionID, runKey, writes, start: async () => {
      if (pending.has(sessionID)) return;
      pending.set(sessionID, runKey);
      try {
        const spawned = await startReview(sessionID);
        if (spawned) reviewSessions.add(spawned);
      }
      finally { pending.delete(sessionID); }
    } });
  }

  return {
    ignoreSession(sessionID) { if (sessionID) reviewSessions.add(sessionID); },
    onStarted(event) {
      const sessionID = event?.data?.sessionID;
      if (!sessionID) return;
      const id = event.id ?? `${event.created ?? Date.now()}`;
      const baseline = Promise.resolve().then(() => diff(sessionID));
      runs.set(sessionID, { id, baseline, finished: false });
    },
    onSucceeded(event) { return finish(event?.data?.sessionID, true); },
    onFailed(event) { return finish(event?.data?.sessionID, false); },
    onInterrupted(event) { return finish(event?.data?.sessionID, false); },
  };
}

/** Wire to the host's real session-execution event API; caller owns cleanup. */
export function subscribeNativeReviewEvents(data, consumer, onError = (_error) => {}) {
  return [
    data.on("session.execution.started", (event) => consumer.onStarted(event)),
    data.on("session.execution.succeeded", (event) => { void consumer.onSucceeded(event).catch(onError); }),
    data.on("session.execution.failed", (event) => { void consumer.onFailed(event).catch(onError); }),
    data.on("session.execution.interrupted", (event) => { void consumer.onInterrupted(event).catch(onError); }),
  ];
}
