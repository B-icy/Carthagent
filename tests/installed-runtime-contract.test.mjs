import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTerminalSemanticsProof, resolveInstalledRuntime } from '../tools/installed-runtime-contract.mjs';

test('installed resolution passes the identical options object through identity reporting', async () => {
  const manifestPath = '/installed/lib/opencode/runtime-release.json';
  let resolverOptions;
  let identityOptions;
  const binary = '/isolated/cache/cli-linux-x64/bin/opencode';
  const result = await resolveInstalledRuntime(async options => {
    resolverOptions = options;
    options.resolvedMarker = true;
    return binary;
  }, async (_binary, options) => {
    identityOptions = options;
    assert.equal(options.resolvedMarker, true);
    return { kind: 'ctg-owned', binarySha256: 'a'.repeat(64) };
  }, manifestPath);

  assert.equal(resolverOptions, identityOptions);
  assert.equal(result.options, resolverOptions);
  assert.equal(result.binary, binary);
  assert.equal(result.identity.kind, 'ctg-owned');
});

test('terminal semantics contract accepts only exact owned controlled-emulator evidence', () => {
  const binary = '/isolated/cache/cli-linux-x64/bin/opencode';
  const identity = { binarySha256: 'b'.repeat(64) };
  const manifest = { runtimeVersion: '0.0.0-ctg.test' };
  const proof = {
    status: 'PASS', binaryResolvedPath: binary, binarySha256: identity.binarySha256,
    binaryVersion: `opencode v${manifest.runtimeVersion}`,
    physicalOSClipboardVerified: false, controlledHostClipboardModel: true,
  };
  assert.doesNotThrow(() => assertTerminalSemanticsProof(proof, { binary, identity, manifest }));
  for (const [key, value] of [
    ['status', 'INCOMPLETE'], ['binaryResolvedPath', '/other/opencode'],
    ['binarySha256', 'c'.repeat(64)], ['binaryVersion', 'opencode v2.0.32'],
    ['physicalOSClipboardVerified', true], ['controlledHostClipboardModel', false],
  ]) {
    assert.throws(() => assertTerminalSemanticsProof({ ...proof, [key]: value }, { binary, identity, manifest }), key);
  }
});
