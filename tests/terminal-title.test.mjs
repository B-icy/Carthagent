import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terminalTitleSequence } from '../lib/tui/title.mjs';

test('terminal title uses Carthagent branding and the workspace folder', () => {
  assert.equal(terminalTitleSequence('/work/my-project'), '\x1b]0;Carthagent - my-project\x07');
  assert.equal(terminalTitleSequence('/'), '\x1b]0;Carthagent\x07');
  assert.equal(terminalTitleSequence('/work/café app'), '\x1b]0;Carthagent - café app\x07');
});

test('terminal title strips control characters from folder names', () => {
  assert.equal(terminalTitleSequence('/work/project\x07\x1b\n\r\x9c'), '\x1b]0;Carthagent - project\x07');
});
