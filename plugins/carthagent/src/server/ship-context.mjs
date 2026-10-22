import { archiveContext } from '../../../../lib/context-archive.mjs';

const DELIVERY = new Set(['delivery_plan', 'delivery_revise', 'delivery_design', 'delivery_status', 'delivery_progress', 'delivery_check', 'delivery_review']);
export const localToolName = name => String(name).replace(/^carthagent[._]/, '');
const blocking = value => /"severity"\s*:\s*"blocking"|"passed"\s*:\s*false/.test(JSON.stringify(value).replaceAll('\\"', '"'));

// Native results can group multiple calls in one message. Never split a call/result
// pair or discard other content on the assistant/result messages when archiving.
export function archiveDeliveryExchanges(messages, { cwd, directory, allow = false, keepRecent = 2 }) {
  if (!allow) return { messages, failed: false };
  const groups = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== 'assistant' || !message.content?.length || message.content.some(part => part.type !== 'tool-call' || !DELIVERY.has(localToolName(part.name)))) continue;
    const ids = new Set(message.content.map(part => part.id));
    if (ids.has(undefined) || ids.size !== message.content.length) continue;
    let end = i + 1;
    const results = [];
    while (end < messages.length && messages[end].role === 'tool') {
      results.push(...messages[end].content);
      end++;
      if (results.length >= ids.size) break;
    }
    if (results.length !== ids.size || results.some(part => part.type !== 'tool-result' || !ids.has(part.id) || part.result?.type === 'error' || blocking(part.result))) continue;
    if (new Set(results.map(part => part.id)).size !== ids.size) continue;
    groups.push({ start: i, end, tools: message.content.map(part => part.name) });
    i = end - 1;
  }
  const replace = new Map(); let failed = false;
  for (const group of groups.slice(0, Math.max(0, groups.length - keepRecent))) {
    try {
      const archive = archiveContext(cwd, directory, messages.slice(group.start, group.end));
      replace.set(group.start, { ...group, archive });
    } catch { failed = true; }
  }
  const projected = [];
  for (let i = 0; i < messages.length;) {
    const group = replace.get(i);
    if (!group) { projected.push(messages[i++]); continue; }
    projected.push({ role: 'user', content: [{ type: 'text', text: `Archived successful delivery exchange (not proof of correctness). Tools: ${group.tools.join(', ')}. Read ${group.archive.path} for original messages; sha256=${group.archive.digest}. Current obligations/failures are in the delivery recovery record.` }] });
    i = group.end;
  }
  return { messages: projected, failed };
}

export function normalizeDesignReview(input) {
  const review = input.review ?? { challenges: input.challenges, walkthroughs: input.walkthroughs, findings: input.findings, limitations: input.limitations };
  return { ...review, captureId: review.captureId ?? input.captureId ?? review.id };
}

export function shellProtection(command, initialFiles) {
  const broad = /\b(?:pkill|killall)\b|\bkill\s+(?:-\S+\s+)*(?:-1|0)(?:\s|$)|\btaskkill\b[^\n]*(?:\/im|\*)|\bstop-process\b[^\n]*\s-name\b|\bget-process\b[^\n]*\|\s*stop-process\b/i;
  if (broad.test(command)) return 'Broad process termination is blocked. Stop only the specific PID/process you started.';
  for (const file of initialFiles) {
    const escaped = file.split(/[\\/]/).at(-1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:>|tee\\s+)\\s*["']?[^\\s;|]*${escaped}(?:["'\\s;|]|$)`).test(command)) return 'Shell redirection cannot overwrite an existing source file. Use a focused edit.';
    if (/writeFile|write_text|write_bytes/.test(command) && command.includes(file.split(/[\\/]/).at(-1))) return 'A script cannot replace an existing source file. Use a focused edit.';
    if (new RegExp(`(?:^|[;&|]\\s*)(?:rm|mv|cp)\\s+[^;|]*${escaped}(?:["'\\s;|]|$)`).test(command)) return 'Shell commands cannot remove or replace an existing source file. Use a focused edit.';
  }
}
