/**
 * Test stand-in for the engine's extension API module.
 * The real engine (vendor/agent) aliases '@earendil-works/pi-coding-agent' to
 * its bundled exports when loading extensions; pulling the whole bundle into a
 * unit test is unnecessary — only these pure helpers are imported.
 */
export const CONFIG_DIR_NAME = '.carthagent';

/** Keep the tail of `content` within maxLines/maxBytes, like the engine does. */
export function truncateTail(content, { maxLines = 2000, maxBytes = 51200 } = {}) {
  const lines = String(content).split('\n');
  if (lines.length <= maxLines && Buffer.byteLength(content, 'utf-8') <= maxBytes) {
    return { content, truncated: false };
  }
  const out = [];
  let bytes = 0;
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const size = Buffer.byteLength(lines[i], 'utf-8') + (out.length ? 1 : 0);
    if (bytes + size > maxBytes) break;
    out.unshift(lines[i]);
    bytes += size;
  }
  return { content: out.join('\n'), truncated: true };
}
