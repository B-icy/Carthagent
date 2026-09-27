import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mostRecentSession } from '../../lib/engine.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const path = process.argv[2] || mostRecentSession(join(root, 'workspace'));
if (!path) { console.log('No session yet'); process.exit(0); }
const entries = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const calls = [], errors = [];
let usage = { input: 0, output: 0, totalTokens: 0, reportedCost: 0 };
for (const entry of entries) {
  const m = entry.message;
  if (m?.role === 'assistant') {
    if (m.errorMessage) errors.push({ at: entry.timestamp, providerError: m.errorMessage });
    for (const item of m.content || []) if (item.type === 'toolCall') calls.push({ at: entry.timestamp, name: item.name, arguments: item.arguments });
    for (const key of ['input', 'output', 'totalTokens']) usage[key] += m.usage?.[key] || 0;
    usage.reportedCost += m.usage?.cost?.total || 0;
  }
  if (m?.role === 'toolResult' && m.isError) errors.push({ at: entry.timestamp, name: m.toolName, result: m.content });
}
const counts = {};
for (const c of calls) counts[c.name] = (counts[c.name] || 0) + 1;
console.log(JSON.stringify({ session: path, toolCalls: calls.length, counts, usage, errors, recent: calls.slice(-8) }, null, 2));
