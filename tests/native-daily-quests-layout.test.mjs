import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../plugins/carthagent/src/ui/daily-quests.tsx', import.meta.url), 'utf8');
const voyages = await readFile(new URL('../plugins/carthagent/src/ui/voyages.tsx', import.meta.url), 'utf8');
const tui = await readFile(new URL('../plugins/carthagent/src/tui.tsx', import.meta.url), 'utf8');
const server = await readFile(new URL('../plugins/carthagent/src/index.ts', import.meta.url), 'utf8');

test('daily quests are registered in the native plugin and reachable from Voyages', () => {
  assert.match(server, /registerDailyQuestsRpc\(context\)/);
  assert.match(server, /registerDailySourceRpc\(context\)/);
  assert.match(tui, /name: "daily-quests", render:.*DailyQuestsPage/);
  assert.match(voyages, /name: "Daily coding quests"/);
  assert.match(voyages, /name: "daily-quests"/);
});

test('evidence editing and the complete outbound preview remain native and scrollable', () => {
  assert.match(page, /<scrollbox ref=\{summary\} flexBasis=\{0\} flexGrow=\{1\} minHeight=\{1\}/);
  assert.match(page, /<textarea ref=\{editor\}[^>]*onContentChange=\{\(\) => syncDailyEditor\(editor, controller\)\}/);
  assert.match(page, /bind: "tab"/);
  assert.match(page, /JSON.stringify\(view\(\).preview, null, 2\)/);
  assert.match(page, /JSON.stringify\(record\(\).request, null, 2\)/);
  assert.match(page, /Ctrl\+P preview, never sends/);
  for (const text of page.matchAll(/<text\b([^>]*)>/g)) assert.match(text[1], /flexShrink=\{0\}/);
});

test('daily cancellation helper is wired to the actual actions ref and page-scoped notice', () => {
  assert.match(page, /actions = node; focus.attachActions\(node\)/);
  assert.match(page, /handleDailyQuestsEvent\(\{\s*controller, event: details, location: location\(\), changedLocation, actions/);
  assert.match(page, /interrupted: !!\(view\(\).draft \|\| view\(\).preview \|\| replayID\(\) \|\| activeDialog\)/);
  assert.match(page, /notice: setCancellationNotice/);
  assert.match(page, /<Show when=\{cancellationNotice\(\)\}>/);
  assert.match(page, /stop\(\); actions = undefined; controller.dispose\(\)/);
});

test('selection starts empty and external consent, retention, uncertainty and no-reward limits are explicit', () => {
  assert.match(page, /let goal = false, change = false/);
  assert.match(page, /new Set<string>\(\), findings = new Set<string>\(\)/);
  assert.match(page, /Consent and send/);
  assert.match(page, /External JEV receives/);
  assert.match(page, /Metadata: 90 days/);
  assert.match(page, /not a background deletion timer/);
  assert.match(page, /automatic secret detection is not provided/);
  assert.match(page, /not independent verification/);
  assert.match(page, /No coins, XP, distance, inventory or other rewards/);
  assert.match(page, /Earlier failed-before execution is not recorded and is never inferred/);
  assert.match(page, /c\.after === "passed" \? "fresh" : "not fresh"/);
  assert.match(page, /\(\{ name: id, before, after, revision, result \}\)/);
  assert.match(page, /view\(\)\.draft\?\.provenance/);
  assert.match(page, /This does not cancel a server job, withdraw evidence already sent, or promise provider\/backup deletion/);
  assert.doesNotMatch(page, /session\.export|file\.read|sendNativeReviewKickoff|outputTail/);
});
