import { designDigest } from './planning.mjs';

const clone = value => value === undefined ? undefined : structuredClone(value);
export const jsonBytes = value => Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');

// A recovery record, not an authorization receipt. No lifecycle state is written.
// Never truncate exact obligations to satisfy an arbitrary presentation cap.
export function deliveryRecovery(state, { report, planningStatus } = {}) {
  const p = state.plan;
  return clone({ version: 1, runId: state.runId, revision: state.revision, digest: designDigest(p), report,
    goal: p.goal, status: state.status, verification: p.verification ?? 'required',
    freshness: 'Recompute from the current source before execution/finish; this record grants no authority.',
    planning: { status: planningStatus, approvedRevision: state.planning?.approval?.revision,
      started: Boolean(state.planning?.started), validationFindings: state.planning?.validation?.findings || [],
      openFindings: state.planning?.openFindings || [],
      reviewFindings: state.planning?.review?.findings || [], reviewLimitations: state.planning?.review?.limitations || [],
      approval: state.planning?.approval, implementationStarted: state.planning?.started }, 
    acceptance: p.acceptance, checks: p.checks, outputs: p.outputs || [], artifacts: p.artifacts,
    assumptions: p.assumptions, steps: p.steps, stepStatus: state.stepStatus,
    requirementRevisions: state.requirementRevisions, verificationStarted: state.verificationStarted,
    lastRevision: state.revisions?.at(-1)?.reason, progressNotes: state.progressNotes?.slice(-5),
    reviewRecorded: Boolean(state.reviewEvidence), reviewLimitations: state.reviewEvidence?.limitations || [],
    evidence: Object.fromEntries(Object.entries(state.evidence || {}).map(([id, e]) => [id, {
      passed: e.passed, fingerprint: e.fingerprint, executedRevision: e.executedRevision,
      code: e.code, timedOut: e.timedOut, log: e.log, outputTail: e.passed ? undefined : e.outputTail?.slice(-400),
    }])),
  });
}

export function designReceipt(action, result) {
  if (action !== 'review') return clone(result);
  // Full walkthroughs/challenges remain persisted. Findings and limitations are
  // not hidden: they can be actionable even when deterministic review succeeded.
  const { walkthroughs, challenges, ...receipt } = result;
  return clone({ ...receipt, walkthroughCount: walkthroughs?.length || 0, challengeCount: challenges?.length || 0 });
}

const DELIVERY = new Set(['delivery_plan', 'delivery_revise', 'delivery_design', 'delivery_status', 'delivery_progress', 'delivery_check', 'delivery_review']);

// Return non-overlapping, successful, completed delivery-only exchanges. The
// caller must archive original objects before replacing them in outbound context.
export function archivalGroups(messages, { keepRecent = 2, allow = false } = {}) {
  if (!allow) return [];
  const groups = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant' || m.stopReason !== 'toolUse' || !Array.isArray(m.content)) continue;
    const calls = m.content.filter(c => c.type === 'toolCall');
    if (!calls.length || calls.some(c => !DELIVERY.has(c.name))) continue;
    const ids = new Set(calls.map(c => c.id));
    if (ids.size !== calls.length || ids.has(undefined)) continue;
    const results = messages.slice(i + 1, i + 1 + calls.length);
    if (results.length !== calls.length || results.some(r => r.role !== 'toolResult' || r.isError || !ids.has(r.toolCallId))) continue;
    if (new Set(results.map(r => r.toolCallId)).size !== ids.size) continue;
    // Validation can return a successful tool result containing blocking findings.
    // Do not archive such diagnostic evidence merely because isError is false.
    if (results.some(r => /"(?:severity)"\s*:\s*"blocking"|"passed"\s*:\s*false/.test(JSON.stringify(r.content).replaceAll('\\"', '"')))) continue;
    groups.push({ start: i, end: i + calls.length + 1, tools: calls.map(c => c.name), messages: messages.slice(i, i + calls.length + 1) });
    i += calls.length;
  }
  return groups.slice(0, Math.max(0, groups.length - Math.max(0, keepRecent)));
}

export function replaceArchivedGroups(messages, groups) {
  const byStart = new Map(groups.map(g => [g.start, g]));
  const out = [];
  for (let i = 0; i < messages.length;) {
    const group = byStart.get(i);
    if (!group) { out.push(messages[i++]); continue; }
    out.push({ role: 'custom', customType: 'delivery-archive', display: false,
      content: `Archived successful delivery exchange (not proof of correctness). Tools: ${group.tools.join(', ')}. Read ${group.archive.path} for original messages; sha256=${group.archive.digest}. Current obligations/failures are in the delivery recovery record.`,
      timestamp: messages[i].timestamp || 0 });
    i = group.end;
  }
  return out;
}

// Count serialized substructures without logging content. These categories sum
// to measured payload bytes; token estimate is intentionally not a hard bound.
export function contextMetrics(payload) {
  const totalBytes = jsonBytes(payload), categories = { system: 0, schemas: 0, planning: 0, toolResults: 0, codeTools: 0, reasoning: 0, conversation: 0, envelope: 0 };
  const schemas = payload?.tools ?? payload?.functions;
  if (schemas) categories.schemas = jsonBytes(schemas);
  for (const m of payload?.messages || []) {
    const remainder = { ...m };
    for (const key of ['reasoning', 'reasoning_content', 'reasoning_details']) if (remainder[key] !== undefined) {
      const before = jsonBytes(remainder);
      delete remainder[key];
      categories.reasoning += before - jsonBytes(remainder);
    }
    const bytes = jsonBytes(remainder);
    const calls = m.tool_calls || [];
    const names = calls.map(c => c.function?.name || c.custom?.name);
    if (m.role === 'system' || m.role === 'developer') categories.system += bytes;
    else if (names.length && names.every(n => DELIVERY.has(n))) categories.planning += bytes;
    else if (names.some(n => ['write', 'edit', 'read'].includes(n))) categories.codeTools += bytes;
    else if (m.role === 'tool') categories.toolResults += bytes;
    else categories.conversation += bytes;
  }
  categories.envelope = totalBytes - Object.values(categories).reduce((a, b) => a + b, 0);
  return { version: 1, totalBytes, categories, estimatedTokens: Math.ceil(totalBytes / 4), estimateNote: 'bytes/4 heuristic, not a tokenizer bound' };
}
