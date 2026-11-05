import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url);
const live = await jiti.import('../plugins/carthagent/src/ui/workspace-live.ts');
const page = await readFile(new URL('../plugins/carthagent/src/ui/workspace.tsx', import.meta.url), 'utf8');
const host = await readFile(new URL('../plugins/carthagent/src/tui.tsx', import.meta.url), 'utf8');

test('workspace report Back returns to the originating session or home', () => {
  assert.deepEqual(live.workspaceReturnRoute('ses_1'), { type: 'session', sessionID: 'ses_1' });
  assert.deepEqual(live.workspaceReturnRoute(undefined), { type: 'home' });
  assert.deepEqual(live.workspaceReturnRoute(''), { type: 'home' });
  // /ctg-workspace keeps its unscoped list but remembers where it was opened from.
  assert.match(host, /case "ctg-workspace":\s*\n\s*context\.ui\.router\.navigate\(\{ type: "plugin", name: "carthagent", data: \{ view: "workspace", \.\.\.\(sessionID \? \{ returnSessionID: sessionID \} : \{\}\) \} \}\)/);
  assert.match(host, /returnSessionID=\{typeof data\?\.returnSessionID === "string" \? data\.returnSessionID : undefined\}/);
});

test('workspace report owns a component-scoped Escape/Tab/PageUp/PageDown layer that yields to dialogs', () => {
  const layer = page.slice(page.indexOf('context.keymap.layer'), page.indexOf('return <box'));
  assert.ok(layer.length > 0, 'WorkspacePage must register a keymap layer (disposed with the component)');
  assert.doesNotMatch(layer, /mode: "global"/);
  assert.match(layer, /bind: "escape"[^\n]*enabled: base[^\n]*run: escape/);
  assert.match(layer, /bind: "tab"[^\n]*enabled: base/);
  assert.match(layer, /bind: "pageup"[^\n]*scrollBy\(-1 \/ 2, "viewport"\)/);
  assert.match(layer, /bind: "pagedown"[^\n]*scrollBy\(1 \/ 2, "viewport"\)/);
  assert.match(page, /const base = \(\) => context\.keymap\.mode\.current\(\) === "base"/);
  // Escape from the Filter returns to the list first; only then does it leave the view.
  assert.match(page, /const escape = \(\) => \{ if \(filterFocused\(\)\) \{ setFilterFocused\(false\); return; \} back\(\); \}/);
  assert.match(page, /onMouseUp=\{pointer\.action\(back\)\}>← Back/);
});

test('Filter and navigation list arbitrate one focus owner for pointer and Tab', () => {
  assert.match(page, /<input [^\n]*focused=\{base\(\) && filterFocused\(\)\}[^\n]*onMouseDown=\{\(\) => setFilterFocused\(true\)\}/);
  assert.match(page, /<input [^\n]*value=\{query\(\)\} onInput=\{setQuery\}/);
  assert.match(page, /<select [^\n]*focused=\{base\(\) && !filterFocused\(\)\}/);
  assert.doesNotMatch(page, /<select [^\n]* focused \/>/);
});

test('report content scrolls in a bounded viewport instead of shrinking rows over each other', () => {
  assert.match(page, /return <box flexDirection="column" flexGrow=\{1\} minHeight=\{0\} overflow="hidden" padding=\{1\}[^>\n]*>/);
  assert.match(page, /<scrollbox ref=\{\(node\) => \{ content = node; \}\} flexBasis=\{0\} flexGrow=\{1\} minHeight=\{1\}/);
  for (const text of page.matchAll(/<text\b([^>]*)>/g)) assert.match(text[1], /flexShrink=\{0\}/, `text must not shrink: ${text[1].slice(0, 80)}`);
  for (const box of page.slice(page.indexOf('<scrollbox')).matchAll(/<box\b([^>]*)>/g)) assert.match(box[1], /flexShrink=\{0\}/);
});

test('DTO section rows are labelled returned or truncated from the data, with readiness-dependent tone', () => {
  const complete = live.renderDeliveryReadiness({ completion: 'ready', gate: 'open', freshness: 'current', truncation: { checks: { returned: 1, total: 1 }, risks: { returned: 0, total: 0 } } });
  assert.deepEqual(complete.sectionRows, [
    { text: 'Returned DTO section · checks: 1 of 1 returned', tone: 'returned' },
    { text: 'Returned DTO section · risks: 0 of 0 returned', tone: 'returned' },
  ]);
  const partial = live.renderDeliveryReadiness({ completion: 'incomplete', gate: 'locked', truncation: { checks: { returned: 100, total: 101 } } });
  assert.deepEqual(partial.sectionRows, [{ text: 'Truncated DTO section · checks: 100 of 101 returned', tone: 'truncated' }]);
  const unknown = live.renderDeliveryReadiness({ completion: 'ready' });
  assert.deepEqual(unknown.sectionRows, [{ text: 'Coverage metadata unavailable: completeness cannot be confirmed', tone: 'unknown' }]);
  // Data semantics stay unchanged.
  assert.deepEqual(complete.sections, ['checks: 1 of 1 returned', 'risks: 0 of 0 returned']);
  assert.doesNotMatch(page, /Incomplete DTO section/);
  assert.doesNotMatch(page, /Returned DTO section · \{section\}/);
  const architecture = page.slice(page.indexOf('<Show when={props.view === "architecture"}>'), page.indexOf('<Show when={props.view === "evidence"}>'));
  assert.match(architecture, /fg=\{readiness\(\)\.gate === "open" \? context\.theme\.text\.feedback\.success\.base : context\.theme\.text\.feedback\.warning\.base\}/);
});

test('review surfaces name the independent code-review receipt and never promote self-review', () => {
  const unreviewed = live.independentReviewText({ status: 'unreviewed' });
  assert.match(unreviewed, /No independent code-review receipt/);
  assert.match(unreviewed, /delivery self-review is model-authored and not an independent review/);
  assert.equal(live.independentReviewText({ status: 'approved', summary: '1 review round(s) · abc' }), 'Independent review approved · 1 review round(s) · abc');
  assert.equal(live.independentReviewText({ status: 'changes-requested' }), 'Independent review requested changes');
  assert.match(live.independentReviewText({ status: 'stale', summary: 'Review source changed since this receipt' }), /^Independent review receipt stale/);
  assert.match(live.independentReviewText({ status: 'invalid' }), /^Independent review receipt invalid/);
  assert.match(live.independentReviewText({ error: 'boom' }), /^Independent review status unavailable: boom/);
  assert.match(live.independentReviewText({ status: 'something-new' }), /^Independent review status: something-new/);
  assert.doesNotMatch(live.independentReviewText(undefined), /approved/);
  assert.match(page, />Independent code-review receipt</);
  assert.match(host, /id === "ctg-review" \? independentReviewText\(await api\.review\(\{ sessionID \}\)\)/);
});
