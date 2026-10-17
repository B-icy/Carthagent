import { cancelSession, createSession, promptSession, serviceRequest, sessionMessages, setSessionEnvironment } from './service.mjs';

/** Create and run a native session, returning structured API results. */
export async function runHeadless(service, workspace, prompt, options = {}) {
  const session = options.sessionID
    ? { id: options.sessionID }
    : await createSession(service, workspace, { body: options.session ?? {} });
  if (!session?.id) throw new Error('OpenCode did not return a session id');
  const id = session.id ?? session.sessionID;
  if (!id) throw new Error('OpenCode did not return a valid session identifier');
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', forwardAbort, { once: true });
  if (options.signal?.aborted) forwardAbort();
  const timeout = options.timeout ?? 120_000;
  const timeoutSignal = AbortSignal.timeout(timeout);
  const signal = AbortSignal.any([controller.signal, timeoutSignal]);
  try {
    await setSessionEnvironment(service, id, options.env ?? process.env, { location: workspace, signal });
    const accepted = await promptSession(service, id, prompt, {
      location: workspace,
      signal,
      body: { ...(options.prompt ?? {}), ...(options.parts ? { parts: options.parts } : {}), text: prompt },
    });
    await serviceRequest(service, 'POST', `/api/experimental/session/${encodeURIComponent(id)}/wait`, { signal, location: { directory: workspace } });
    const fetched = await sessionMessages(service, id, { signal, location: workspace });
    const messages = chronologicalMessages(fetched);
    return { session, accepted, messages, result: extractAssistant(messages, accepted) };
  } catch (error) {
    if (options.signal?.aborted || timeoutSignal.aborted) {
      await cancelSession(service, id, { location: workspace, signal: AbortSignal.timeout(5000) }).catch(() => {});
      if (timeoutSignal.aborted && !options.signal?.aborted) throw new Error(`OpenCode headless prompt timed out after ${timeout}ms`, { cause: error });
    }
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', forwardAbort);
  }
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

function extractAssistant(messages, accepted) {
  const assistantMessages = messages.filter((item) => item.type === 'assistant' || item.info?.role === 'assistant' || item.role === 'assistant');
  const latestAssistant = assistantMessages.at(-1);
  const acceptedTime = accepted?.time?.created;
  const message = Number.isFinite(acceptedTime)
    ? assistantMessages.find((item) => (item.time?.created ?? item.timestamp ?? 0) >= acceptedTime) ?? latestAssistant
    : latestAssistant;
  if (!message) return undefined;
  const parts = message.parts ?? message.content ?? [];
  return {
    status: message.finish ?? message.info?.finish ?? message.info?.status ?? message.status,
    text: Array.isArray(parts) ? parts.filter((part) => part.type === 'text' || part.type === 'text-delta' || typeof part.text === 'string').map((part) => part.text ?? '').join('') : String(parts),
    error: message.error ?? message.info?.error,
    message,
  };
}

export { cancelSession, createSession, promptSession, sessionMessages, setSessionEnvironment };
