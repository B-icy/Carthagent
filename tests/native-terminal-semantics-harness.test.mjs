import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../tools/native-terminal-semantics.py', import.meta.url), 'utf8');

test('terminal semantics opens a session before staging and submitting its prompt', () => {
  assert.match(source, /if not session_opened and not picker_only and ready_for_prompt:[\s\S]*?os\.write\(master, b'\\r'\)[\s\S]*?session_opened = True/);
  assert.match(source, /session_opened and not sent and not picker_only[\s\S]*?os\.write\(master, b'\\x1b\[200~' \+ payload \+ b'\\x1b\[201~'\)/);
  assert.match(source, /if sent and time\.monotonic\(\) - pasted_at > 1\.5 and not Provider\.received:[\s\S]*?os\.write\(master, b'\\r'\)/);
});

test('terminal semantics never stages a prompt until picker cancellation and home restoration pass', () => {
  assert.match(source, /still_open = \(picker_heading in current_screen or 'no matches' in current_screen/);
  assert.match(source, /picker_home_restored = \('ask anything' in current_screen or[\s\S]*?'what is the tech' in current_screen\)/);
  assert.match(source, /picker_cancel_passed = \(not picker_started or[\s\S]*?get\('status'\) == 'PASS'\)/);
  assert.match(source, /'noPromptProviderRequestBeforeAcceptance': no_provider_request/);
});

test('terminal semantics reports clipboard/title proof as controlled-host modeling, not OS claims', () => {
  assert.match(source, /'physicalOSClipboardVerified': False/);
  assert.match(source, /'terminalTitleRestoration'/);
  assert.match(source, /'selectionClipboard'/);
  assert.match(source, /'clipboardOSC52'/);
});
