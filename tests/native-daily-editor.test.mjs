import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { syncDailyEditor } from '../plugins/carthagent/src/ui/daily-editor.mjs';
import { createDailyQuestsState } from '../plugins/carthagent/src/ui/daily-quests-state.mjs';

test('pinned renderer empty content-change events read current text before canonical preview', async () => {
  // Guard the actual pinned implementation, not the misleading Solid callback
  // type. This is an adapter contract test, not a native FFI rendering test.
  const module = await readFile(new URL('../node_modules/@opentui/core/index.node.js', import.meta.url), 'utf8');
  const chunkName = module.match(/from "(\.\/chunk-node-[^"]+)"/g)
    .map(value => value.match(/"([^"]+)"/)[1]);
  const chunks = await Promise.all(chunkName.map(name => readFile(new URL(`../node_modules/@opentui/core/${name.slice(2)}`, import.meta.url), 'utf8')));
  assert.ok(chunks.some(source => source.includes('this._contentChangeListener({})')), 'Pinned renderer event shape changed; review the adapter');
  const id = '11111111-1111-4111-8111-111111111111';
  const detail = { id, status: 'open', definition: { title: 'Adapter contract' }, latestSubmission: null };
  const writes = [];
  let view;
  const controller = createDailyQuestsState({ api: {
    snapshot: async () => ({ accountKey: 'a'.repeat(64), slate: { items: [detail] }, records: [] }),
    detail: async () => detail,
    submit: async input => { writes.push(input); },
  }, changed: next => { view = next; } });
  try {
    await controller.refresh(); await controller.select(id);
    await controller.compose(async () => ({ id, evidence: { projectId: id, outcomeId: id, runId: id, revision: '', goal: 'private text selected originally', change: '', checks: [], findings: [] } }));
    const edited = JSON.parse(view.draft.text);
    edited.goal = 'Redacted user-approved goal'; edited.revision = 'a'.repeat(40);
    const editor = { plainText: JSON.stringify(edited) };
    const onContentChange = () => syncDailyEditor(editor, controller);
    onContentChange({});
    controller.preview();
    assert.equal(view.phase, 'preview');
    assert.equal(view.preview.evidence.goal, edited.goal);
    assert.equal(view.preview.evidence.revision, edited.revision);
    assert.doesNotMatch(JSON.stringify(view.preview), /private text/);
    assert.deepEqual(writes, []);
    controller.backToEdit();
    edited.goal = ''; editor.plainText = JSON.stringify(edited);
    onContentChange({}); controller.preview();
    assert.equal(view.preview.evidence.goal, '');
  } finally { controller.dispose(); }
});
