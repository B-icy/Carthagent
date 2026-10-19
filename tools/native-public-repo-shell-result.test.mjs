import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNativeShellResult } from './native-public-repo-shell-result.mjs';

test('accepts exact zero-status Mocha result with expected passing count', () => {
  assert.equal(assertNativeShellResult('  111 passing (10ms)\nCTG_NATIVE_EXIT_STATUS=0', { status: 0, passingTests: 111 }), 0);
});

test('rejects Mocha output reporting passing tests and any failing tests despite a zero-status trailer', () => {
  assert.throws(
    () => assertNativeShellResult('  111 passing (10ms)\n  1 failing\nCTG_NATIVE_EXIT_STATUS=0', { status: 0, passingTests: 111 }),
    /must not report any failing tests/,
  );
});

test('rejects nonzero native status even when output claims all package tests passed', () => {
  assert.throws(
    () => assertNativeShellResult('  111 passing (10ms)\n  1 failing\nCTG_NATIVE_EXIT_STATUS=1\nExited with code 1', { status: 0, passingTests: 111 }),
    /exit status must be 0/,
  );
});

test('fails closed when native result has no explicit status trailer', () => {
  assert.throws(
    () => assertNativeShellResult('  111 passing (10ms)', { status: 0, passingTests: 111 }),
    /must end with its explicit/,
  );
});
