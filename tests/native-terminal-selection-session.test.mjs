import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const helper = await readFile(new URL('../tools/terminal-semantics-decisions.py', import.meta.url), 'utf8');
const probe = await readFile(new URL('../tools/native-terminal-selection-session.py', import.meta.url), 'utf8');
const runner = await readFile(new URL('../tools/run-native-terminal-selection-fixture.mjs', import.meta.url), 'utf8');
const fixture = await readFile(new URL('../tools/native-fixture.mjs', import.meta.url), 'utf8');

test('existing-session selection probe gates on stable rendered body and exact OSC 52 substring', () => {
  assert.match(helper, /def rendered_fixture_body_row/);
  assert.match(probe, /body_row\(line\[:columns\], args\.response\)/);
  assert.match(probe, /stable_samples < 5/);
  assert.match(probe, /updates == \[args\.selection\] and readback == args\.selection/);
  assert.match(probe, /'physicalOSClipboardVerified': False/);
  assert.match(probe, /--expected-sha256/);
  assert.match(probe, /--expected-version/);
  assert.match(probe, /capturedPtyIndependentReplayBodyMatchesGesture/);
});

test('existing-session selection probe can retain PTY and JSON evidence', () => {
  assert.match(probe, /--retain-state/);
  assert.match(probe, /native-terminal-selection-\{args\.session\}\.pty/);
  assert.match(probe, /native-terminal-selection-\{args\.session\}\.json/);
});

test('selection fixture seeds and waits for a completed provider response before attaching', () => {
  assert.match(runner, /await host\.outcome\(session\.id\)/);
  assert.match(runner, /'--expected-provider-ready'/);
  assert.match(probe, /fixtureProviderTurnCompleted/);
  assert.match(runner, /CTG_TEST_RUNTIME_ARTIFACT_ROOT is required/);
  assert.match(runner, /CTG_TEST_RUNTIME_RELEASE_MANIFEST is required/);
  assert.match(runner, /CTG_TEST_RUNTIME_SHA256 must provide/);
  assert.match(runner, /preflightNativeTestRuntimeArtifact/);
  assert.match(runner, /assert\.equal\(preflight\.identity\.binarySha256, expectedDigest/);
  assert.match(runner, /host\.close\(\{ preserveTemp:/);
  assert.doesNotMatch(runner, /spawn\(|process\.kill\(|killpg/);
  assert.match(fixture, /runtimeResolver \?\? productRuntime/);
});
