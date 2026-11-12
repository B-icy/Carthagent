import test from 'node:test';
import assert from 'node:assert/strict';
import { headlessFailureMessage } from '../lib/opencode/cli-runtime.mjs';

test('a dropped model stream tells the user how to continue the saved session', () => {
  for (const error of [
    'Connection lost while reading the response: ECONNRESET: The socket connection was closed unexpectedly.',
    'The upstream connection was interrupted mid-generation. Retry the request to continue on another backend.',
  ]) {
    const message = headlessFailureMessage({ outcome: 'failed', error, session: { id: 'ses_abc' } });
    assert.match(message, /^Native run failed: /);
    assert.match(message, /ctg --print --session ses_abc "Continue the task"/, error);
  }
  assert.match(headlessFailureMessage({ outcome: 'failed', error: 'socket hang up ECONNRESET' }), /ctg --print --continue/);
});

test('other failures keep their original message', () => {
  assert.equal(headlessFailureMessage({ outcome: 'failed', error: 'model_not_found' }), 'Native run failed: model_not_found');
});
