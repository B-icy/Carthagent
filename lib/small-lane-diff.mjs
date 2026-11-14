/**
 * Content guard for the Ship fast lane.
 *
 * A request routed "small" says what kind of edit it is (a typo, a comment, a
 * local rename...). At finish, every changed file is compared before/after and
 * the change must be of that kind. Anything else (a one-line logic change
 * hiding in a "typo fix") escalates to the full flow. This is the backstop for
 * the keyword router, which cannot read intent.
 *
 * Kinds:
 *  - text:       only comments, string literals, JSX/HTML text and docs change.
 *  - whitespace: only whitespace changes (Python/YAML indentation is code).
 *  - rename:     like text, plus one identifier consistently renamed.
 *  - imports:    like text, plus import statements removed or trimmed.
 *  - bump:       like text, plus version numbers changed, manifests only.
 */

const DOC = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
const C_LIKE = /\.(m?[jt]sx?|cjs|cts|mts|java|kt|kts|swift|go|rs|c|cc|cpp|h|hpp|cs|scala|dart|php|css|scss|less)$/i;
const HASH = /\.(py|pyi|rb|sh|bash|zsh|ya?ml|toml|ini|cfg|conf|r)$/i;
const MARKUP = /\.(html?|xml|svg|vue|svelte)$/i;
const JSON_FILE = /\.(json|jsonc|json5)$/i;
const INDENT_SENSITIVE = /\.(py|pyi|ya?ml)$/i;
const JSX = /\.[jt]sx$/i;
const TEXT_ATTRIBUTES = /^(alt|title|placeholder|aria-label|aria-description|aria-placeholder|label|content|summary|caption|tooltip|helperText|description|text)$/i;
const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|composer\.json|Gemfile|requirements[\w.-]*\.txt|setup\.cfg)$/i;

export const SMALL_LANE_KINDS = Object.freeze(['text', 'whitespace', 'rename', 'imports', 'bump']);

/** The kind of a small request, from its wording. Most permissive kind wins only when named. */
export function smallLaneKind(task) {
  const t = String(task ?? '');
  if (/\bbump\b/i.test(t)) return 'bump';
  if (/\bunused imports?\b|\bimport order\b/i.test(t)) return 'imports';
  if (/\brenam\w*\b/i.test(t)) return 'rename';
  if (/\b(indent\w*|whitespace|trailing (?:newline|whitespace|comma))\b/i.test(t) && !/\b(typo|spelling|grammar|wording|reword|rephrase|comment|docstring|jsdoc|label|tooltip|placeholder|text|message)\b/i.test(t)) return 'whitespace';
  return 'text';
}

function language(path) {
  if (DOC.test(path)) return 'doc';
  if (JSON_FILE.test(path)) return 'json';
  if (C_LIKE.test(path)) return 'c';
  if (HASH.test(path)) return 'hash';
  if (MARKUP.test(path)) return 'markup';
  return 'unknown';
}

/**
 * Split source into code with comments and string contents removed. Strings
 * become a placeholder so `"a" + x` and `"b" + x` compare equal while
 * `"a" + x` and `"a" + y` do not. Template literals keep their ${} code.
 */
export function codeSkeleton(source, path, { keepSpacing = false } = {}) {
  const lang = language(path);
  const s = String(source);
  if (lang === 'doc') return '';
  let out = '';
  let i = 0;
  const n = s.length;
  const lineComment = lang === 'c' && !/\.(css|scss|less)$/i.test(path) ? '//' : lang === 'hash' ? '#' : null;
  const blockComments = lang === 'c' ? [['/*', '*/']] : lang === 'markup' ? [['<!--', '-->']] : [];
  const markupish = JSX.test(path) || lang === 'markup';
  const quotes = lang === 'hash' ? ['"""', "'''", '"', "'"] : lang === 'json' ? ['"'] : lang === 'markup' ? ['"', "'"] : ['"', "'", '`'];
  while (i < n) {
    const block = blockComments.find(([open]) => s.startsWith(open, i));
    if (block) { const end = s.indexOf(block[1], i + block[0].length); i = end < 0 ? n : end + block[1].length; out += ' '; continue; }
    if (lineComment && s.startsWith(lineComment, i) && !(lang === 'c' && s[i - 1] === ':')) { while (i < n && s[i] !== '\n') i++; continue; }
    const quote = quotes.find(q => s.startsWith(q, i));
    // JSX/HTML attribute values are code (classes, ids, hrefs, handlers) unless the attribute holds copy.
    const attribute = quote && markupish ? /([\w:-]+)\s*=\s*$/.exec(s.slice(Math.max(0, i - 40), i)) : null;
    if (attribute && !TEXT_ATTRIBUTES.test(attribute[1])) { const end = s.indexOf(quote, i + 1); out += s.slice(i, end < 0 ? n : end + 1); i = end < 0 ? n : end + 1; continue; }
    if (quote) {
      i += quote.length;
      out += '"S"';
      while (i < n && !s.startsWith(quote, i)) {
        if (s[i] === '\\') { i += 2; continue; }
        if (quote === '`' && s.startsWith('${', i)) {
          // Template expression: code, kept.
          let depth = 1; i += 2; out += '${';
          while (i < n && depth) { if (s[i] === '{') depth++; else if (s[i] === '}') depth--; if (depth) out += s[i]; i++; }
          out += '}';
          continue;
        }
        if (quote.length === 1 && quote !== '`' && s[i] === '\n') break;
        i++;
      }
      i += quote.length;
      continue;
    }
    out += s[i++];
  }
  // Text between tags is copy, not code: JSX/HTML text children.
  if (JSX.test(path) || lang === 'markup') out = out.replace(/([\w"'}\/])>([^<>{}]*?)</g, '$1>T<');
  if (INDENT_SENSITIVE.test(path)) {
    return out.split('\n').map(line => line.replace(/\s+$/, '')).filter(line => line.trim()).map(line => line.replace(/\s+/g, ' ')).join('\n');
  }
  return keepSpacing ? out.replace(/\s+/g, ' ').trim() : out.replace(/\s+/g, '');
}

const identifiers = code => code.match(/[A-Za-z_$][\w$]*|\S/g) || [];

/** True when `after` is `before` with exactly one identifier renamed everywhere it appears. */
function oneConsistentRename(before, after) {
  const a = identifiers(before), b = identifiers(after);
  if (a.length !== b.length) return false;
  let pair = null;
  for (let k = 0; k < a.length; k++) {
    if (a[k] === b[k]) continue;
    if (!/^[A-Za-z_$]/.test(a[k]) || !/^[A-Za-z_$]/.test(b[k])) return false;
    if (!pair) pair = [a[k], b[k]];
    else if (pair[0] !== a[k] || pair[1] !== b[k]) return false;
  }
  // Every occurrence was renamed, and the new name did not already exist.
  return !pair || (!b.includes(pair[0]) && !a.includes(pair[1]));
}

const IMPORT_LINES = /^\s*(?:import\b[\s\S]*?(?:from\s*)?["'][^"'\n]+["'];?|(?:export\s+)?(?:const|let|var)\s+[^=\n]+=\s*require\(\s*["'][^"'\n]+["']\s*\);?|from\s+[\w.]+\s+import\s+(?:\([^)]*\)|[^\n]+)|import\s+[\w., ]+)\s*$/gm;
const VERSION = /\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/g;

/**
 * Check one changed file against the lane kind. Returns '' when allowed,
 * otherwise a short reason.
 */
export function smallLaneFileViolation(kind, path, before, after) {
  const lang = language(path);
  if (before === after) return '';
  if (lang === 'doc') return '';
  if (lang === 'unknown') return `${path}: file type not checked by the fast lane`;
  if (kind === 'whitespace') {
    if (INDENT_SENSITIVE.test(path)) {
      const strip = text => String(text).split('\n').map(line => line.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
      return strip(before) === strip(after) ? '' : `${path}: indentation is code in this language`;
    }
    return String(before).replace(/\s+/g, '') === String(after).replace(/\s+/g, '') ? '' : `${path}: more than whitespace changed`;
  }
  if (kind === 'bump') {
    if (!MANIFEST.test(path)) return `${path}: a version bump may only change a dependency manifest`;
    return String(before).replace(VERSION, 'V') === String(after).replace(VERSION, 'V') ? '' : `${path}: more than version numbers changed`;
  }
  const b = codeSkeleton(before, path), a = codeSkeleton(after, path);
  if (b === a) return '';
  if (kind === 'imports') {
    const without = text => codeSkeleton(String(text).replace(IMPORT_LINES, ''), path);
    return without(before) === without(after) ? '' : `${path}: code outside import statements changed`;
  }
  if (kind === 'rename') return oneConsistentRename(codeSkeleton(before, path, { keepSpacing: true }), codeSkeleton(after, path, { keepSpacing: true })) ? '' : `${path}: code changed beyond one consistent rename`;
  return `${path}: code changed, not just comments, strings or text`;
}
