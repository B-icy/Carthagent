/** Firefox WebDriver BiDi log capture. Subscribe before navigation, never silently degrade. */
export async function captureBrowserErrors(url) {
  if (!url) throw Error('Driver did not provide a BiDi webSocketUrl; error capture unavailable');
  const socket = new WebSocket(url);
  const pending = new Map();
  const errors = [];
  let dropped = 0;
  let sequence = 0;
  let closed = false;
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.id !== undefined) {
      const handler = pending.get(message.id);
      if (handler) { pending.delete(message.id); handler(message); }
    }
    if (message.method === 'log.entryAdded' && message.params.level === 'error') {
      const entry = message.params;
      if (errors.length === 50) { dropped++; return; }
      errors.push({ type: entry.type, text: String(entry.text ?? '').slice(0, 2000),
        stack: (entry.stackTrace?.callFrames || []).slice(0, 8).map(frame => ({ url: String(frame.url).slice(0, 500), lineNumber: frame.lineNumber, columnNumber: frame.columnNumber })) });
    }
  });
  socket.addEventListener('close', () => { closed = true; });
  async function command(method, params) {
    if (closed) throw Error('Browser error capture connection closed');
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`BiDi ${method} timed out`)); }, 5000);
      pending.set(id, message => {
        clearTimeout(timer);
        if (message.type === 'error') reject(Error(`BiDi ${method}: ${message.message}`));
        else resolve(message.result);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('BiDi connection timed out')), 5000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('BiDi connection failed')); }, { once: true });
    });
    await command('session.subscribe', { events: ['log.entryAdded'] });
  } catch (error) { socket.close(); throw error; }
  return {
    async inspect() {
      // Round trip on the same event channel before consuming the observed log.
      await command('session.status', {});
      return { errors: [...errors], dropped };
    },
    close() { socket.close(); }
  };
}
