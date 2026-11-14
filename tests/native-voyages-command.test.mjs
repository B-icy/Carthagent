import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createJiti } from 'jiti';

const { COMMANDS, voyagesCommandRoute } = await createJiti(import.meta.url).import('../plugins/carthagent/src/ui/commands.ts');

// VOY-02: the command name, its description and its destination must agree.
test('/voyages with no argument opens the Voyages hub, not Daily goals', () => {
  assert.deepEqual(voyagesCommandRoute('voyages', '', 'ses_1'), { kind: 'navigate', name: 'voyages', data: { sessionID: 'ses_1', section: 'profile' } });
  assert.deepEqual(voyagesCommandRoute('voyages', '  '), { kind: 'navigate', name: 'voyages', data: { section: 'profile' } });
});

test('/quests still reaches Daily goals; /voyages claim still opens the claim', () => {
  assert.deepEqual(voyagesCommandRoute('quests', '', 'ses_1'), { kind: 'navigate', name: 'daily-quests', data: { sessionID: 'ses_1' } });
  assert.deepEqual(voyagesCommandRoute('voyages', 'Claim', 'ses_1'), { kind: 'navigate', name: 'voyages', data: { sessionID: 'ses_1', section: 'profile', claim: true } });
  assert.equal(voyagesCommandRoute('voyages', 'claim').kind, 'error');
  assert.match(voyagesCommandRoute('voyages', 'goals').message, /\/quests/);
});

test('command descriptions promise only what the destination shows', () => {
  const voyages = COMMANDS.find(c => c.id === 'voyages');
  const quests = COMMANDS.find(c => c.id === 'quests');
  assert.match(voyages.description, /character, ship and shop/);
  assert.doesNotMatch(voyages.description, /daily goals/i);
  assert.match(quests.description, /Daily goals/);
});

test('tui dispatch uses the shared route for both commands', () => {
  const tui = readFileSync(new URL('../plugins/carthagent/src/tui.tsx', import.meta.url), 'utf8');
  assert.match(tui, /case "voyages":\s*case "quests": \{\s*const route = voyagesCommandRoute\(id, arg, sessionID\)/);
});
