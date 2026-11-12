import test from 'node:test';
import assert from 'node:assert/strict';
import { pickerOptions } from '../plugins/carthagent/src/ui/daily-quests-picker.mjs';

test('work picker groups sessions by evidence instead of truncating inline descriptions', () => {
  const sources = { a: { origin: 'session' }, b: { origin: 'ship', freshness: 'current' }, c: { origin: 'ship', freshness: 'stale' }, d: { origin: 'session' } };
  const options = pickerOptions([{ id: 'a', title: 'A long session title that previously ran into its description' }, { id: 'b', title: 'B' }, { id: 'c' }, { id: 'd', title: 'D' }], id => sources[id]);
  assert.deepEqual(options.map(o => o.value), ['b', 'c', 'a', 'd'], 'verified first, stale next, user-evidence sessions last; stable within a group');
  assert.deepEqual(options.map(o => o.category), ['Verified Ship work', 'Checks need refreshing', 'Other sessions · add evidence yourself', 'Other sessions · add evidence yourself']);
  assert.equal(options[1].title, 'Untitled session');
  assert.ok(options.every(o => o.description === undefined), 'no inline description to collide with the title');
});
