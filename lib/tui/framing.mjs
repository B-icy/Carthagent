/**
 * Behind-the-scenes phased-delivery framing (the carthagent default flow).
 *
 * Every typed task is a phased delivery run: the raw text is what the user
 * sees echoed in the feed, while the engine receives the expanded delivery template
 * body. Resolving the template here (rather than forwarding "/guide <task>"
 * to the engine) keeps the behavior identical in --isolate and headless -p modes,
 * and keeps the machinery invisible in the feed.
 *
 * This is the default flow for carthagent — the whole product is built around it —
 * so the input pill stays empty and the hint rotates through generic
 * builder one-liners.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const TEMPLATE_PATH = join(ROOT, 'prompts', 'delivery.md');

let cached = null;

export const FRAME_HINTS = ['Message carthagent…'];

export function frameHint() {
  return FRAME_HINTS[0];
}

function readTemplate(path) {
  let body = '';
  try {
    const raw = readFileSync(path, 'utf8');
    const fm = raw.match(/^---\n[\s\S]*?\n---\n?/);
    body = (fm ? raw.slice(fm[0].length) : raw).trim();
  } catch { body = ''; }
  return body;
}

/** Body of prompts/delivery.md with frontmatter stripped. '' when unreadable. */
export function framingTemplate(path = TEMPLATE_PATH) {
  if (path === TEMPLATE_PATH) {
    if (cached == null) cached = readTemplate(TEMPLATE_PATH);
    return cached;
  }
  return readTemplate(path);
}

/** Expand the delivery template for a task. Falls back to the bare task text. */
export function framePrompt(task, template = framingTemplate()) {
  const t = String(task).trim();
  if (!template) return t;
  return template.includes('$@') ? template.replaceAll('$@', t) : `${template}\n\n${t}`;
}

/** Recover the original task text from a framed prompt, else null. */
export function unframe(text) {
  // Match the current template suffix first: the task itself may contain
  // blank lines (or even phase headings). Keep the legacy format fallback.
  const value = String(text);
  const template = framingTemplate();
  const parts = template.split('$@');
  if (parts.length === 2 && value.startsWith(parts[0]) && value.endsWith(parts[1])) {
    return value.slice(parts[0].length, parts[1] ? -parts[1].length : undefined).trim();
  }
  const m = value.match(/^Deliver this task in phases(?: with executable evidence)?:\s*([\s\S]*?)\n\n/);
  return m ? m[1].trim() : null;
}

/** True when a submitted prompt should get the delivery framing. */
export function shouldFrame(text, { enabled = true, delivery = true } = {}) {
  if (!enabled || !delivery) return false;
  const v = String(text).trim();
  if (!v) return false;
  if (v.startsWith('/') || v.startsWith('!')) return false;
  // Questions/read-only asks are not delivery runs.
  if (v.endsWith('?') && v.length < 300) return false;
  if (/^(what|why|how|explain|show|list|describe|review|where|is|are|does|do|can)\b/i.test(v) && v.length < 300 && !/\b(build|create|implement|write|add|fix|make|generate)\b/i.test(v)) return false;
  return existsSync(TEMPLATE_PATH);
}
