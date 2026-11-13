/**
 * Cheap, deterministic routing of a Ship request: no model call.
 *
 *  - 'answer': a question or read-only ask (shared looksInformational rule).
 *  - 'small':  a short, single-target edit such as a typo, rename, comment,
 *              wording or version bump. Ship offers the fast lane
 *              (delivery_small), which still requires fresh passing checks.
 *  - 'full':   everything else, and anything risky or unclear.
 *
 * The router only ever downgrades when it is confident; a wrong 'full' costs
 * time, a wrong 'small' is caught by the fast lane's scope guard at finish.
 */
import { looksInformational } from './delivery.mjs';

export const SHIP_ROUTES = Object.freeze(['answer', 'small', 'full']);

// Areas where a small-looking edit can still do real damage: always full.
const RISKY = /\b(auth\w*|login|logout|session|password|passkey|secret|token|credential|permission|role|security|vulnerab\w*|encrypt\w*|crypto|payment|billing|invoice|price|money|coin|wallet|trade|order|migration|migrate|schema|database|sql|prisma|delete|drop|truncate|deploy\w*|release|production|prod|ci|workflow|infra\w*|docker\w*|lock ?file|concurren\w*|race|thread)\b/i;
// The user asked for care.
const CAREFUL = /\b(thorough(?:ly)?|carefully|full (?:review|flow|delivery)|in depth|end[- ]to[- ]end|refactor|redesign|architect\w*|rewrite|overhaul)\b/i;
// Edits that are small by nature.
const SMALL_KIND = /\b(typo|misspell\w*|spelling|grammar|wording|reword|rephrase|rename|comment|docstring|jsdoc|readme|changelog|copy ?text|label|tooltip|placeholder|log message|error message|message text|bump|version|trailing (?:newline|whitespace|comma)|whitespace|indent\w*|lint (?:warning|error)|unused import|import order|typo fix)\b/i;
const EDIT_VERB = /\b(fix|change|update|edit|replace|rename|reword|bump|add|remove|correct|tweak|adjust)\b/i;
// A file-looking token: has a slash or a dotted extension.
const FILE_TOKEN = /(?:^|[\s`'"(])((?:[\w@.-]+\/)*[\w@-]*[a-z_@-][\w@-]*\.[a-z][a-z0-9]{0,7})(?=$|[\s`'",:;)])/gi;

export function mentionedFiles(text) {
  return [...new Set([...String(text).matchAll(FILE_TOKEN)].map(match => match[1]))];
}

/** Route a Ship request. Returns { route, reason }. */
export function shipRoute(text) {
  const task = String(text ?? '').trim();
  if (!task) return { route: 'full', reason: 'empty' };
  if (looksInformational(task)) return { route: 'answer', reason: 'question or read-only ask' };
  if (task.length > 220) return { route: 'full', reason: 'long request' };
  if (task.split(/[.!?;\n]+\s/).filter(part => part.trim()).length > 2) return { route: 'full', reason: 'several parts' };
  if (/\b(and then|then also|as well as|plus)\b/i.test(task)) return { route: 'full', reason: 'several parts' };
  if (CAREFUL.test(task)) return { route: 'full', reason: 'asked for a thorough change' };
  if (RISKY.test(task)) return { route: 'full', reason: 'touches a sensitive area' };
  const files = mentionedFiles(task);
  if (files.length > 2) return { route: 'full', reason: 'several files' };
  if (SMALL_KIND.test(task) && EDIT_VERB.test(task)) return { route: 'small', reason: 'small kind of edit' };
  if (SMALL_KIND.test(task) && files.length) return { route: 'small', reason: 'small kind of edit' };
  return { route: 'full', reason: 'not clearly small' };
}

/** Fast-lane scope: what a "small" change may touch before it must escalate. */
export const SMALL_LANE_LIMITS = Object.freeze({ files: 3, lines: 80 });

/**
 * Check a finished fast-lane change against its declared scope.
 * changed: [{ path, lines }] for files changed since the lane started.
 * Returns a list of reasons; empty means it stayed small.
 */
export function smallLaneOverflow(changed, declared, limits = SMALL_LANE_LIMITS) {
  const norm = path => String(path).replace(/\\/g, '/').replace(/^\.\//, '');
  const allowed = new Set(declared.map(norm));
  const reasons = [];
  const outside = changed.map(entry => norm(entry.path)).filter(path => !allowed.has(path));
  if (outside.length) reasons.push(`changed files outside the declared set: ${outside.slice(0, 5).join(', ')}`);
  if (changed.length > limits.files) reasons.push(`${changed.length} files changed (fast lane allows ${limits.files})`);
  const lines = changed.reduce((sum, entry) => sum + (Number(entry.lines) || 0), 0);
  if (lines > limits.lines) reasons.push(`${lines} lines changed (fast lane allows ${limits.lines})`);
  return reasons;
}
