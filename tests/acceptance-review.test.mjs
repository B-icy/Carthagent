import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptanceReviewerPrompt } from '../lib/acceptance-review.mjs';
test('workspace reviewer preserves original request and challenges integration without domain specialization', () => {
  const request = 'Persist submitted orders and reject unauthorized callers';
  const prompt = acceptanceReviewerPrompt(request);
  assert.ok(prompt.endsWith(request));
  assert.match(prompt, /Do not modify product source/);
  assert.match(prompt, /Test normal execution separately/);
  assert.match(prompt, /producer\/consumer representation agreement/);
  assert.doesNotMatch(prompt, /Panda3D|voxel|Minecraft|camera|terrain/);
  assert.throws(() => acceptanceReviewerPrompt(''), /required/);
});
