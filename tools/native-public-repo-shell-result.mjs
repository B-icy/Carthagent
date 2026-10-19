import assert from 'node:assert/strict';

/** Validate the explicit status trailer emitted by a wrapped native shell call. */
export function assertNativeShellResult(output, { status, passingTests } = {}) {
  const match = /(?:^|\n)CTG_NATIVE_EXIT_STATUS=(\d+)\s*(?:\nExited with code \d+\s*)?$/.exec(output);
  assert.ok(match, 'native shell result must end with its explicit CTG_NATIVE_EXIT_STATUS trailer');
  assert.equal(Number(match[1]), status, `native shell exit status must be ${status}`);
  if (passingTests !== undefined) {
    assert.match(output, new RegExp(`(?:^|\\n)\\s*${passingTests} passing(?:\\s|\\()`, 'i'), `Mocha output must report ${passingTests} passing tests`);
    assert.doesNotMatch(output, /(?:^|\n)\s*[1-9]\d* failing(?:\s|\()/i, 'Mocha output must not report any failing tests');
  }
  return Number(match[1]);
}
