import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trimHistoryMedia, IMAGE_BUDGET } from '../plugins/carthagent/src/server/history-media.mjs';

// INF-01: a 2.1 MB screenshot read by a tool made every later Cloud request
// fail with request_too_large (gateway byte budget 600,000), even on --continue.
const png = bytes => `data:image/png;base64,${'A'.repeat(bytes)}`;
const readResult = (id, bytes, name = 'shot.png') => ({ role: 'tool', content: [{ type: 'tool-result', id, name: 'read', result: { type: 'content', value: [{ type: 'text', text: 'Image read successfully' }, { type: 'file', uri: png(bytes), mime: 'image/png', name }] } }] });
const userImage = bytes => ({ role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'media', media: { source: { type: 'base64', data: 'A'.repeat(bytes), mediaType: 'image/png' } } }] });
const size = messages => JSON.stringify(messages).length;

test('an oversized tool screenshot is replaced by a note; text and the call pairing survive', () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'open big.png' }] }, readResult('call-1', 2_800_000, 'big.png'), { role: 'user', content: [{ type: 'text', text: 'continue' }] }];
  const { messages: out, omitted } = trimHistoryMedia(messages);
  assert.equal(omitted, 1);
  assert.ok(size(out) < 600_000, 'request now fits the gateway budget');
  const value = out[1].content[0].result.value;
  assert.equal(out[1].content[0].id, 'call-1');
  assert.equal(value[0].text, 'Image read successfully');
  assert.match(value[1].text, /^\[Image big\.png omitted from this request \(2734 KB\).*unchanged on disk/);
  assert.equal(messages[1].content[0].result.value[1].type, 'file', 'input is not mutated');
  assert.equal(out[0], messages[0]);
});

test('the newest images that fit the budget are kept; older ones go first', () => {
  const messages = [readResult('a', 120_000, 'old.png'), userImage(100_000), readResult('b', 120_000, 'new.png')];
  const { messages: out, omitted } = trimHistoryMedia(messages);
  assert.equal(omitted, 1);
  assert.match(out[0].content[0].result.value[1].text, /Image old\.png omitted/);
  assert.equal(out[1].content[1].type, 'media');
  assert.equal(out[2].content[0].result.value[1].type, 'file');
});

test('small images, URLs and image-free histories pass through unchanged', () => {
  const small = [readResult('a', 50_000), { role: 'user', content: [{ type: 'media', media: { source: { type: 'url', url: 'https://x/y.png' } } }] }];
  assert.equal(trimHistoryMedia(small).messages, small);
  const plain = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
  assert.equal(trimHistoryMedia(plain).messages, plain);
  assert.ok(IMAGE_BUDGET < 600_000);
  const oversizedUser = trimHistoryMedia([userImage(700_000)]);
  assert.equal(oversizedUser.omitted, 1);
  assert.equal(oversizedUser.messages[0].content[1].type, 'text');
});

test('the Cloud provider registers the trim as a context hook scoped to carthagent-cloud', () => {
  const source = readFileSync(new URL('../plugins/carthagent/src/server/providers.ts', import.meta.url), 'utf8');
  assert.match(source, /hook\('context', async event => \{\n\s+if \(event\.model\.providerID !== EXPERIENTIAL_PROVIDER_ID\) return;\n\s+const trimmed = trimHistoryMedia\(event\.messages\);/);
});
