import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamSimple as streamOpenAiCompletions } from '../vendor/agent/chunks/openai-completions-EKZT2IH2.js';

const model = {
  id: 'carthagent-code',
  name: 'Carthagent Code',
  provider: 'experiential-labs',
  api: 'openai-completions',
  baseUrl: 'https://cloud.test/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1_000,
  maxTokens: 100,
  headers: {},
  compat: {
    supportsUsageInStreaming: false,
    supportsFinishReason: true,
    supportsDeveloperRole: true,
    supportsStore: false,
    supportsReasoningEffort: false,
    supportsOpenAIGrammarTools: false,
  },
};

const eventStream = content => new Response(
  `data: ${JSON.stringify({ id: 'request-1', model: 'carthagent-code', choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
  { status: 200, headers: { 'content-type': 'text/event-stream' } },
);

test('identity-only OpenAI models omit unknown limits and preserve unknown pricing', async () => {
  const calls = [];
  const identityOnlyModel = {
    id: 'carthagent-code',
    name: 'carthagent-code',
    provider: 'experiential-labs',
    api: 'openai-completions',
    baseUrl: 'https://cloud.test/v1',
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(
      `data: ${JSON.stringify({ id: 'request-identity', model: 'carthagent-code', choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  };

  const result = await streamOpenAiCompletions(identityOnlyModel, {
    messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
  }, {
    apiKey: 'test-access-token',
    fetch: fetchImpl,
    maxRetries: 0,
  }).result();

  assert.equal(result.stopReason, 'stop');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.max_tokens, undefined);
  assert.equal(calls[0].body.max_completion_tokens, undefined);
  assert.equal(result.usage.input, 2);
  assert.equal(result.usage.output, 1);
  assert.equal(result.usage.cost.total, 0);
  assert.equal(result.usage.cost.unknown, true);
});

test('OpenAI transport preserves request-scoped headers across SDK retries', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'retry' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    return eventStream('ok');
  };

  const result = await streamOpenAiCompletions(model, {
    messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
  }, {
    apiKey: 'test-access-token',
    fetch: fetchImpl,
    maxRetries: 1,
    maxRetryDelayMs: 1,
    requestHeaders: {
      'Idempotency-Key': 'operation-1',
      'X-Client-Request-Id': 'operation-1',
    },
  }).result();

  assert.equal(result.stopReason, 'stop');
  assert.equal(calls.length, 2);
  for (const { init } of calls) {
    assert.equal(init.headers.get('idempotency-key'), 'operation-1');
    assert.equal(init.headers.get('x-client-request-id'), 'operation-1');
  }
});
