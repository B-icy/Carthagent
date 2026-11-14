// Carthagent Cloud sizes a request by its JSON bytes (Carthagent-Backend
// lib/cloud/gateway.mjs estimateInputTokens) and rejects anything over the
// model's max_input_tokens (600,000 in production) with request_too_large.
// One inline screenshot is often 1-3 MB of base64, and the stored session
// resends it on every later request, so `--continue` keeps failing.
//
// Before each Cloud request, keep the newest inline images while they fit in
// IMAGE_BUDGET and replace the rest with a short text note. Only the outgoing
// request changes; the stored session keeps the original file.

export const IMAGE_BUDGET = 250_000;

const DATA_URI = /^data:([^;,]+)?(?:;[^,]*)?,/;

const inlineFileBytes = part => part?.type === 'file' && typeof part.uri === 'string' && DATA_URI.test(part.uri) ? part.uri.length : 0;

function inlineMediaBytes(part) {
  if (part?.type !== 'media') return 0;
  const source = part.media?.source;
  if (source?.type === 'base64' && typeof source.data === 'string') return source.data.length;
  if (source?.type === 'bytes' && source.data?.length) return Math.ceil(source.data.length * 4 / 3);
  return 0;
}

const kb = bytes => `${Math.round(bytes / 1024)} KB`;

const note = (name, bytes) => `[Image ${name ? `${name} ` : ''}omitted from this request (${kb(bytes)}): it is too large to resend to Carthagent Cloud. The file is unchanged on disk. To look at it again, resize it first (for example a ≤1280px JPEG under 200 KB) or inspect the page or DOM as text instead.]`;

/**
 * Return messages whose inline images fit `budget` bytes, newest kept first.
 * Untouched messages are returned as-is; nothing is mutated.
 * @returns {{ messages: any[], omitted: number, omittedBytes: number }}
 */
export function trimHistoryMedia(messages, { budget = IMAGE_BUDGET } = {}) {
  if (!Array.isArray(messages)) return { messages, omitted: 0, omittedBytes: 0 };
  // Locate every inline image: [messageIndex, partIndex, valueIndex | -1, bytes, name].
  const found = [];
  messages.forEach((message, m) => {
    (message?.content || []).forEach((part, p) => {
      const media = inlineMediaBytes(part);
      if (media) found.push([m, p, -1, media, part.media?.name || part.filename]);
      const value = part?.type === 'tool-result' && part.result?.type === 'content' && Array.isArray(part.result.value) ? part.result.value : [];
      value.forEach((item, v) => { const bytes = inlineFileBytes(item); if (bytes) found.push([m, p, v, bytes, item.name]); });
    });
  });
  let used = 0;
  const drop = new Set();
  let omittedBytes = 0;
  for (const entry of [...found].reverse()) {
    if (used + entry[3] <= budget) { used += entry[3]; continue; }
    drop.add(entry); omittedBytes += entry[3];
  }
  if (!drop.size) return { messages, omitted: 0, omittedBytes: 0 };
  const byMessage = new Map();
  for (const entry of drop) byMessage.set(entry[0], [...(byMessage.get(entry[0]) || []), entry]);
  const projected = messages.map((message, m) => {
    const entries = byMessage.get(m);
    if (!entries) return message;
    const content = message.content.map((part, p) => {
      const here = entries.filter(entry => entry[1] === p);
      if (!here.length) return part;
      const whole = here.find(entry => entry[2] === -1);
      if (whole) return { type: 'text', text: note(whole[4], whole[3]) };
      const value = part.result.value.map((item, v) => {
        const hit = here.find(entry => entry[2] === v);
        return hit ? { type: 'text', text: note(hit[4], hit[3]) } : item;
      });
      return { ...part, result: { ...part.result, value } };
    });
    return { ...message, content };
  });
  return { messages: projected, omitted: drop.size, omittedBytes };
}
