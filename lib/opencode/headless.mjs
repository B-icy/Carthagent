import { cancelSession, createSession, promptSession, serviceRequest, sessionMessages } from './service.mjs';

/** Create and run a native session, returning structured API results. */
export async function runHeadless(service, workspace, prompt, options = {}) {
  const session = options.sessionID
    ? { id: options.sessionID }
    : await createSession(service, workspace, { body: options.session ?? {} });
  if (!session?.id) throw new Error('OpenCode did not return a session id');
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', forwardAbort, { once: true });
  if (options.signal?.aborted) forwardAbort();
  try {
    const accepted = await promptSession(service, session.id, prompt, {
      signal: controller.signal,
      body: options.prompt ?? {},
      parts: options.parts,
    });
    await serviceRequest(service, 'POST', `/api/experimental/session/${encodeURIComponent(session.id)}/wait`, { signal: options.signal });
    const messages = await sessionMessages(service, session.id, { signal: options.signal });
    return { session, accepted, messages };
  } catch (error) {
    if (options.signal?.aborted) await cancelSession(service, session.id).catch(() => {});
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

export { cancelSession, createSession, promptSession, sessionMessages };
