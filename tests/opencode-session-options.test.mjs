import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { effectiveSessionOptions, normalizeSessionOptions, sessionOptionsMetadata } from '../lib/opencode/session-options.mjs';

test('native session options isolate concurrent settings and resolve paths at the owning worktree', () => {
  const defaults = { maxTools: 5, workflow: 'standard' };
  const a = { location: { directory: resolve('first') }, metadata: sessionOptionsMetadata({ maxTools: '8', guide: false, validators: 'checks.json' }, resolve('first'), { other: true }) };
  const b = { location: { directory: resolve('second') }, metadata: sessionOptionsMetadata({ maxTools: 2, workflow: 'strict' }, resolve('second')) };
  assert.equal(effectiveSessionOptions(a, defaults).maxTools, 8);
  assert.equal(effectiveSessionOptions(b, defaults).maxTools, 2);
  assert.equal(effectiveSessionOptions(a, defaults).validators, resolve('first/checks.json'));
  assert.equal(effectiveSessionOptions(a, defaults).guide, false);
  assert.equal(effectiveSessionOptions(b, defaults).guide, true);
  assert.deepEqual(defaults, { maxTools: 5, workflow: 'standard' });
  assert.equal(a.metadata.other, true);
});

test('invalid persisted limits fail closed and non-runtime options never enter metadata', () => {
  for (const options of [{ maxTools: -1 }, { maxSeconds: 'no' }, { delivery: false, maxTools: 1 }, { codegraphMaxFiles: 0 }, { guide: 'false' }, { workflow: 'anything' }]) {
    assert.throws(() => normalizeSessionOptions(options));
  }
  assert.deepEqual(normalizeSessionOptions({ apiKey: 'secret', theme: 'carthage', model: 'provider/model', guide: false }), { guide: false });
  assert.throws(() => effectiveSessionOptions({ location: { directory: resolve('.') }, metadata: { 'carthagent.options': [] } }), /persisted/);
});
