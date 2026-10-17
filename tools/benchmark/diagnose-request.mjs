// Offline inspection of captured native OpenAI-compatible gateway requests.
// Never creates a session, runs tools, reconstructs a Pi payload, or sends network traffic.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha } from './runtime.mjs';

export function inspectRequest(payload) {
  const issues = [], pending = new Set(), seen = new Set();
  let toolCalls = 0, toolResults = 0;
  for (const [index, message] of payload.messages.entries()) {
    if (message.role === 'tool') {
      toolResults++;
      if (!pending.delete(message.tool_call_id)) issues.push(`message ${index}: unmatched tool result`);
      continue;
    }
    if (pending.size) issues.push(`message ${index}: missing tool results before ${message.role}`);
    for (const call of message.tool_calls || []) {
      toolCalls++;
      if (seen.has(call.id)) issues.push(`message ${index}: duplicate tool id`);
      seen.add(call.id);
      pending.add(call.id);
      try { JSON.parse(call.function.arguments); } catch { issues.push(`message ${index}: invalid tool arguments`); }
    }
  }
  if (pending.size) issues.push('Missing final tool results');
  return {
    toolCalls, toolResults, issues,
    model: payload.model,
    stream: payload.stream,
    maxTokens: payload.max_tokens,
    toolChoice: payload.tool_choice,
    tools: payload.tools?.map(tool => tool.function?.name),
  };
}

export async function inspectCapturedRequest(capturePath) {
  const source = readFileSync(capturePath, 'utf8');
  const payload = JSON.parse(source);
  if (!payload || typeof payload !== 'object' || typeof payload.model !== 'string' || !Array.isArray(payload.messages)) {
    throw Error('Captured OpenAI-compatible request must include a model and messages array');
  }
  const report = {
    runtime: 'opencode-2',
    sourceHash: sha(source),
    normalizedHash: sha(JSON.stringify(payload)),
    sourceBytes: Buffer.byteLength(source),
    normalizedBytes: Buffer.byteLength(JSON.stringify(payload)),
    messages: payload.messages.length,
    ...inspectRequest(payload),
  };
  return { payload, report };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [capturePath, output] = process.argv.slice(2);
  if (!capturePath || !output) throw Error('Usage: diagnose-request.mjs CAPTURED_REQUEST.json NEW_OUTPUT_DIRECTORY');
  const { payload, report } = await inspectCapturedRequest(capturePath);
  mkdirSync(output, { mode: 0o700 });
  writeFileSync(join(output, 'payload.json'), JSON.stringify(payload), { mode: 0o600 });
  writeFileSync(join(output, 'inspection.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
}
