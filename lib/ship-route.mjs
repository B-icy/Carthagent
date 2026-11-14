/**
 * Cheap, deterministic routing of a Ship request: no model call.
 *
 *  - 'answer': a question or read-only ask (shared looksInformational rule).
 *  - 'small':  a short, single-target edit such as a typo, rename, comment,
 *              wording or version bump. Ship offers the fast lane
 *              (delivery_small), which still requires fresh passing checks.
 *  - 'full':   everything else, and anything risky or unclear.
 *
 * The router only downgrades when it is confident; a wrong 'full' costs time.
 * A wrong 'small' is bounded by the fast lane's guards at finish (declared
 * files, size, and text-only content for text-only kinds of edit).
 */
import { looksInformational } from './delivery.mjs';

export const SHIP_ROUTES = Object.freeze(['answer', 'small', 'full']);

// Areas where a small-looking edit can still do real damage: always full.
const RISKY = /\b(auth\w*|login|logout|session|password|passkey|secret|token|credential|permission|role|security|vulnerab\w*|encrypt\w*|crypto|payment|billing|invoice|price|money|coin|wallet|trade|order|migration|migrate|schema|database|sql|prisma|table|column|env(?:ironment)? var\w*|delete|drop|truncate|deploy\w*|config(?:uration)?|settings?|release|production|prod|ci|workflow|infra\w*|docker\w*|lock ?file|concurren\w*|race|thread|rate[- ]?limit\w*|api|route|endpoint|json|key|keys|http header|header name|query|url|selector|id|path)\b/i;
// SCREAMING_CASE names are usually env vars or shared constants. Case-sensitive on purpose.
const CONSTANT = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;
const RISKY_PATH = /(?:^|[\/._-])(auth\w*|login|session\w*|secret\w*|token\w*|credential\w*|permission\w*|security|crypto|payment\w*|billing|invoice\w*|wallet|trade\w*|order\w*|migrations?|schema|prisma|sql|db|database|deploy\w*|release\w*|docker\w*|k8s|helm|terraform|infra\w*|\.github|workflows?|ci|config|settings|env|middleware|delete\w*|danger\w*)(?:[\/._-]|$)/i;
// HTTP status codes: their wording is part of an API contract.
const STATUS_CODE = /\b[1-5]\d\d\b(?!\.\d)/;
// The user asked for care.
const CAREFUL = /\b(thorough(?:ly)?|carefully|full (?:review|flow|delivery)|in depth|end[- ]to[- ]end|refactor|redesign|architect\w*|rewrite|overhaul)\b/i;
// Scope words: the edit is not confined to a named place.
const BROAD = /\b(everywhere|across|throughout|codebase|repo(?:sitory)?[- ]wide|project[- ]wide|all (?:usages?|uses|occurrences?|references?|files|places|instances)|every (?:file|usage|occurrence|reference|place)|globally)\b/i;
// Behaviour phrasing: the request describes what the program should do.
const BEHAVIOUR = /\b(so (?:it|that|they|the)|no longer|instead of (?:\w+ing)|rejects?|accepts?|allows?|prevents?|handles?|validates?|bug|broken (?!link)|off[- ]by[- ]one|to mention|crash\w*|fails?|failing|error when|shows? (?:the|a|an)?\s*\w+ (?:when|if)|where (?:the|it)|leaks?|logic|behaviou?r|format(?:s|ting)?|to include|include the|(?<!comment )to (?:show|display|say|warn|tell)|so users?|make (?:the|it|this) \w+ (?:required|optional|visible|hidden)|condition|calculat\w*|returns? (?:a|an|the)? ?\w+ (?:when|if))\b/i;
// Names in code: a "typo" in one of these is a rename that other code may depend on.
const CODE_NAME = /\b(?:function|method|class|css class|class ?name|variable|type|prop(?:erty)?|field|key|event|selector|attribute|identifier|component) ?names?\b|\bclass(?:Name)?\b|\b(?:(?:typo|spelling|fix|change|update|correct)\w* (?:in|of) (?:the )?(?:enum|constant|regex|regexp|regular expression|default value|import path))\b|\bvalue of\b/i;
// Renaming something other code (or users) depends on.
const PUBLIC_RENAME = /\brenam\w*\b[^.]*\b(export\w*|default|model|type|interface|class|component|module|package|function|method|api|route|endpoint|table|column|field|prop(?:erty)?|key|event|command|flag|option|setting|file|folder|directory)\b/i;
// Requests whose content the agent would have to invent.
const OPEN_CONTENT = /\b(new|latest|updated?) (?:setup |install(?:ation)? |usage )?(?:steps|instructions|docs|documentation|section|content|guide|info(?:rmation)?)\b|\bwith the new\b/i;
// Edits that are small by nature.
const SMALL_KIND = /\b(typo|misspell\w*|spelling|grammar|wording|reword|rephrase|rename|comment|docstring|jsdoc|copy ?text|label|tooltip|placeholder|bump|trailing (?:newline|whitespace|comma|period)|whitespace|indent\w*|lint (?:warning|error)|unused import|import order)\b/i;
const EDIT_VERB = /\b(fix|change|update|edit|replace|rename|reword|rephrase|bump|add|remove|correct|tweak|adjust)\b/i;
// A version bump is small only to an exact patch-level version, never a bare major.
const BUMP = /\bbump\b/i;
const EXACT_VERSION = /\b\d+\.\d+\.\d+\b/;
// A file-looking token: has a slash or a dotted extension that starts with a letter.
const FILE_TOKEN = /(?:^|[\s`'"(])((?:[\w@.-]+\/)*[\w@-]*[a-z_@-][\w@-]*\.[a-z][a-z0-9]{0,7})(?=$|[\s`'",:;.)])/gi;

export function mentionedFiles(text) {
  return [...new Set([...String(text).matchAll(FILE_TOKEN)].map(match => match[1].replace(/\.$/, '')))];
}

/**
 * Route a Ship request. Returns { route, reason }.
 * Every check that can say 'full' runs before anything can say 'small';
 * 'small' needs a small kind of edit, an edit verb and a named file.
 */
export function shipRoute(text) {
  const task = String(text ?? '').trim();
  if (!task) return { route: 'full', reason: 'empty' };
  if (looksInformational(task)) return { route: 'answer', reason: 'question or read-only ask' };
  if (task.length > 220) return { route: 'full', reason: 'long request' };
  if (task.split(/[.!?;\n]+\s/).filter(part => part.trim() && !/^(?:nothing else|do nothing else|only that|that's it)\.?$/i.test(part.trim())).length > 2) return { route: 'full', reason: 'several parts' };
  if (/\b(and then|then also|as well as|plus)\b/i.test(task) || /\band (?:the )?(?:\w+ )?(?:logic|value|code|behaviou?r|implementation|test|default|setting|config\w*)s?\b/i.test(task)) return { route: 'full', reason: 'several parts' };
  if (/\b(?:a|an|the) [\w-]+(?: [\w-]+)? and (?:a|an|the) [\w-]+/i.test(task)) return { route: 'full', reason: 'several parts' };
  if (/(?:,\s*|\s)and (?:then )?(?:also )?(?:lower|raise|increase|decrease|change|update|fix|add|remove|set|make|move|delete|replace|rename|bump|switch|enable|disable|hide|show|disable|wrap|sort|filter|log)\b/i.test(task)) return { route: 'full', reason: 'several parts' };
  // Judge the words, not file names: "package.json" or "lib/auth-copy.md" are targets, not topics.
  const words = task.replace(FILE_TOKEN, ' ');
  if (CAREFUL.test(words)) return { route: 'full', reason: 'asked for a thorough change' };
  if (RISKY.test(words) || CONSTANT.test(words) || STATUS_CODE.test(words.replace(EXACT_VERSION, ''))) return { route: 'full', reason: 'touches a sensitive area' };
  if (BROAD.test(words)) return { route: 'full', reason: 'not confined to one place' };
  if (BEHAVIOUR.test(words)) return { route: 'full', reason: 'describes a behaviour change' };
  if (CODE_NAME.test(words)) return { route: 'full', reason: 'changes a name used in code' };
  if (PUBLIC_RENAME.test(words)) return { route: 'full', reason: 'renames something other code depends on' };
  // A rename is small only when the request says the name is local (a variable or parameter).
  if (/\brenam\w*\b/i.test(task) && !/\b(local|variable|var|param(?:eter)?|argument|loop (?:index|counter))\b/i.test(task)) {
    return { route: 'full', reason: 'rename of a name that may be shared' };
  }
  if (OPEN_CONTENT.test(words)) return { route: 'full', reason: 'content to be written is not given' };
  if (BUMP.test(task) && !EXACT_VERSION.test(task)) return { route: 'full', reason: 'version bump without an exact version' };
  const files = mentionedFiles(task);
  // Risky by location, whatever the wording: auth, payments, infra, CI, migrations, env and config.
  if (files.some(file => RISKY_PATH.test(file))) return { route: 'full', reason: 'file is in a sensitive area' };
  if (files.length > 2) return { route: 'full', reason: 'several files' };
  if (!files.length) return { route: 'full', reason: 'no file named' };
  if (SMALL_KIND.test(task) && EDIT_VERB.test(task)) return { route: 'small', reason: 'small kind of edit in a named file' };
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
