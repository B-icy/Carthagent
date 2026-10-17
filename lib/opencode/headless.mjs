import { cancelSession, createSession, getSession, promptSession, serviceRequest, sessionMessages, setSessionEnvironment } from './service.mjs';

const POLL_INTERVAL = 50;
const MAX_TURN_MESSAGES = 200;

/** Create and run a native session, returning its terminal execution outcome. */
export async function runHeadless(service, workspace, prompt, options = {}) {
  // Avoid installing a forwarding listener (or allocating timeout state) for
  // calls that are already cancelled. This also keeps repeated calls on a
  // shared AbortSignal listener-free.
  if (options.signal?.aborted) return preAdmissionResult(options.sessionID, 'aborted', options.signal.reason);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', forwardAbort, { once: true });
  const timeout = options.timeout ?? 120_000;
  const deadline = Date.now() + timeout;
  const timeoutSignal = AbortSignal.timeout(timeout);
  const signal = AbortSignal.any([controller.signal, timeoutSignal]);
  let created;
  let id = options.sessionID;
  let session;
  let accepted;
  let promptStarted = false;
  try {
    if (!id) {
      created = await createSession(service, workspace, { body: options.session ?? {}, signal });
      id = created?.id ?? created?.sessionID;
    }
    if (!id) throw new Error('OpenCode did not return a valid session identifier');
    session = created ?? { id };
    await setSessionEnvironment(service, id, options.env ?? process.env, { location: workspace, signal });
    promptStarted = true;
    accepted = await promptSession(service, id, prompt, {
      location: workspace,
      signal,
      body: { ...(options.prompt ?? {}), ...(options.parts ? { parts: options.parts } : {}), text: prompt },
    });
    await serviceRequest(service, 'POST', `/api/experimental/session/${encodeURIComponent(id)}/wait`, { signal, location: workspace });
    session = await waitForOutcome(service, id, workspace, { deadline, signal, accepted });
    const fetched = await sessionMessages(service, id, { signal, location: workspace });
    const messages = currentTurnMessages(chronologicalMessages(fetched), accepted, options.maxMessages);
    const result = extractAssistant(messages, accepted);
    const idle = terminalIdle(messages);
    const outcome = session.outcome ?? idle?.outcome ?? 'failed';
    const terminal = Boolean(session.outcome || idle);
    return {
      session,
      accepted,
      messages,
      result,
      outcome,
      terminal,
      reason: session.ctg?.reason,
      budgetReason: terminal ? undefined : session.ctg?.reason ?? 'terminal outcome was not observed before timeout',
      error: outcome === 'failed' ? result?.error ?? session.error ?? idle?.error : undefined,
    };
  } catch (error) {
    if (options.signal?.aborted || timeoutSignal.aborted) {
      if (!accepted) {
        if (id && promptStarted) await cancelSession(service, id, { location: workspace, timeout: 5000 }).catch(() => {});
        return preAdmissionResult(id, options.signal?.aborted ? 'aborted' : 'timed-out', error, options.signal?.reason);
      }
      await cancelSession(service, id, { location: workspace, timeout: 5000 }).catch(() => {});
      const saved = await observeOutcome(service, id, workspace, AbortSignal.timeout(5000)).catch(() => session);
      if (saved?.outcome) session = saved;
      const reason = options.signal?.aborted ? 'aborted' : 'timed-out';
      return incompleteResult(service, id, workspace, accepted, session, reason, error, options.signal?.reason);
    }
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

function preAdmissionResult(sessionID, reason, cause, abortReason) {
  const outcome = reason === 'aborted' ? 'interrupted' : 'timed-out';
  return {
    ...(sessionID ? { session: { id: sessionID } } : {}),
    messages: [],
    result: undefined,
    outcome,
    terminal: false,
    reason,
    budgetReason: outcome === 'timed-out' ? reason : undefined,
    cause: cause?.message,
    abortReason: abortReason?.message,
  };
}

async function waitForOutcome(service, sessionID, workspace, { deadline, signal, accepted }) {
  let lastError;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      const session = await getSession(service, sessionID, { location: workspace, signal });
      if (session?.outcome) return session;
      lastError = undefined;
    } catch (error) {
      if (error.status !== 503) throw error;
      lastError = error;
    }
    if (Date.now() >= deadline) break;
    await delay(Math.min(POLL_INTERVAL, deadline - Date.now()), signal);
  }
  const observed = await observeOutcome(service, sessionID, workspace, AbortSignal.timeout(5000)).catch(() => undefined);
  const messages = await sessionMessages(service, sessionID, { location: workspace, signal: AbortSignal.timeout(5000) }).catch(() => []);
  const turnMessages = currentTurnMessages(chronologicalMessages(messages), accepted);
  const idle = terminalIdle(turnMessages);
  const reason = lastError ? 'session projection remained unavailable (503)' : 'session outcome was not observed';
  return {
    ...(observed ?? { id: sessionID }),
    outcome: observed?.outcome ?? idle?.outcome ?? 'failed',
    error: observed?.error ?? idle?.error ?? lastError,
    ctg: { terminal: Boolean(observed?.outcome || idle), reason, acceptedMessageID: accepted?.id },
  };
}

async function observeOutcome(service, sessionID, workspace, signal) {
  return getSession(service, sessionID, { location: workspace, signal });
}

async function incompleteResult(service, sessionID, workspace, accepted, session, reason, cause, abortReason) {
  const fetched = await sessionMessages(service, sessionID, { location: workspace, signal: AbortSignal.timeout(5000) }).catch(() => []);
  const messages = currentTurnMessages(chronologicalMessages(fetched), accepted);
  const idle = terminalIdle(messages);
  // The session-level outcome may belong to a previously completed turn. Only
  // an idle message bounded to this accepted prompt can establish a terminal
  // outcome for the current turn.
  const outcome = idle?.outcome;
  const result = extractAssistant(messages, accepted);
  const reasonText = session.ctg?.reason ?? reason;
  const finalOutcome = outcome ?? (reason === 'timed-out' ? 'timed-out' : 'interrupted');
  const { outcome: _priorOutcome, ...sessionWithoutPriorOutcome } = session;
  return {
    session: { ...sessionWithoutPriorOutcome, ...(outcome ? { outcome } : {}), error: session.error ?? idle?.error },
    accepted,
    messages,
    result,
    outcome: finalOutcome,
    error: finalOutcome === 'failed' ? result?.error ?? session.error ?? idle?.error : undefined,
    terminal: Boolean(idle),
    reason: reasonText,
    budgetReason: finalOutcome === 'timed-out' || finalOutcome === 'failed' ? reasonText : undefined,
    cause: cause?.message,
    abortReason: abortReason?.message,
  };
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() { signal.removeEventListener('abort', aborted); resolve(); }
    function aborted() { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(signal.reason); }
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

function chronologicalMessages(messages) {
  const list = Array.isArray(messages) ? messages : messages?.data ?? messages?.messages ?? [];
  return [...list].reverse().sort((left, right) => messageTime(left) - messageTime(right));
}

function messageTime(item) {
  const value = item.time?.created ?? item.timestamp ?? item.info?.time?.created ?? item.info?.timestamp ?? 0;
  const number = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(number) ? number : 0;
}

function terminalIdle(messages) {
  return [...messages].reverse().find((item) => item.type === 'idle' && ['succeeded', 'failed', 'interrupted'].includes(item.outcome));
}

function currentTurnMessages(messages, accepted, limit = MAX_TURN_MESSAGES) {
  const acceptedIndex = accepted?.id ? messages.findIndex((item) => item.id === accepted.id) : -1;
  const lastUserIndex = acceptedIndex >= 0
    ? acceptedIndex
    : messages.reduce((latest, item, index) => item.type === 'user' ? index : latest, -1);
  const turn = lastUserIndex >= 0 ? messages.slice(lastUserIndex) : messages;
  return turn.slice(-Math.max(1, Math.min(MAX_TURN_MESSAGES, Number.isInteger(limit) ? limit : MAX_TURN_MESSAGES)));
}

function extractAssistant(messages, accepted) {
  const assistantMessages = messages.filter((item) => item.type === 'assistant' || item.info?.role === 'assistant' || item.role === 'assistant');
  const latestAssistant = assistantMessages.at(-1);
  const acceptedTime = accepted?.time?.created;
  const acceptedIndex = accepted?.id ? messages.findIndex((item) => item.id === accepted.id) : -1;
  const assistantAfterAccepted = acceptedIndex >= 0
    ? assistantMessages.filter((item) => messages.indexOf(item) > acceptedIndex).at(-1)
    : undefined;
  const message = acceptedIndex >= 0
    ? assistantAfterAccepted
    : (Number.isFinite(acceptedTime) ? assistantMessages.filter((item) => messageTime(item) >= acceptedTime).at(-1) : undefined) ?? latestAssistant;
  if (!message) return undefined;
  const parts = message.parts ?? message.content ?? [];
  return {
    status: message.finish ?? message.info?.finish ?? message.info?.status ?? message.status,
    text: Array.isArray(parts) ? parts.filter((part) => part.type === 'text' || part.type === 'text-delta' || typeof part.text === 'string').map((part) => part.text ?? '').join('') : String(parts),
    error: message.error ?? message.info?.error,
    message,
  };
}

export { cancelSession, createSession, getSession, promptSession, sessionMessages, setSessionEnvironment };
