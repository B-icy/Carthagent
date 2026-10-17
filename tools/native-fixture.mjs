/** Offline OpenAI-compatible SSE fixture used by the real OpenCode host test. */
import { createServer } from 'node:http';

export function createNativeFixture({ respond, inspect } = {}) {
  let calls = 0;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    calls++;
    const parsed = body ? JSON.parse(body) : {};
    inspect?.({ request, body: parsed, call: calls });
    if (!parsed.stream) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'stream=true required' } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' });
    response.flushHeaders();
    await respond?.({ request, body: parsed, call: calls, response });
    response.end('data: [DONE]\n\n');
  });
  return {
    server,
    get calls() { return calls; },
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve(`http://127.0.0.1:${server.address().port}/v1`);
      });
    }),
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

export function toolCall(response, { id = 'fixture-call', name, arguments: input }) {
  response.write(`data: ${JSON.stringify({
    id: 'fixture-response', object: 'chat.completion.chunk', created: 1, model: 'fixture',
    choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{
      index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(input) },
    }] }, finish_reason: 'tool_calls' }],
  })}\n\n`);
}

export function assistantText(response, text) {
  response.write(`data: ${JSON.stringify({
    id: 'fixture-response', object: 'chat.completion.chunk', created: 1, model: 'fixture',
    choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  })}\n\n`);
}
