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
  try {
    await setSessionEnvironment(service, id, options.env ?? process.env, { location: workspace, signal: controller.signal });
    const accepted = await promptSession(service, id, prompt, {
      location: workspace,
      signal: controller.signal,
      body: { ...(options.prompt ?? {}), ...(options.parts ? { parts: options.parts } : {}), text: prompt },
    });
    await serviceRequest(service, 'POST', `/api/experimental/session/${encodeURIComponent(id)}/wait`, { signal: controller.signal, location: { directory: workspace } });
    const messages = await sessionMessages(service, id, { signal: controller.signal, location: workspace });
    return { session, accepted, messages, result: extractAssistant(messages) };
  } catch (error) {
    if (options.signal?.aborted) await cancelSession(service, id, { location: workspace }).catch(() => {});
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

function extractAssistant(messages) {
  const list = Array.isArray(messages) ? messages : messages?.data ?? messages?.messages ?? [];
  const message = [...list].reverse().find((item) => item.type === 'assistant' || item.info?.role === 'assistant' || item.role === 'assistant');
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
