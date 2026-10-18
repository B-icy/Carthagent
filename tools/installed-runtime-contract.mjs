/** Shared installed-default resolution contract, kept small for offline regression tests. */
export async function resolveInstalledRuntime(resolveOpenCode, runtimeIdentity, manifestPath) {
  const options = { runtimeReleaseManifestPath: manifestPath };
  const binary = await resolveOpenCode(options);
  const identity = await runtimeIdentity(binary, options);
  return { binary, identity, options };
}

export function assertTerminalSemanticsProof(proof, { binary, identity, manifest }) {
  if (proof.status !== 'PASS') throw new Error('controlled terminal harness did not pass all configured checks');
  if (proof.binaryResolvedPath !== binary) throw new Error('PTY proof did not identify the default-resolved runtime executable');
  if (proof.binarySha256 !== identity.binarySha256) throw new Error('PTY proof executable digest differs from trusted owned identity');
  if (proof.binaryVersion !== `opencode v${manifest.runtimeVersion}`) throw new Error('PTY proof version differs from packaged runtime manifest');
  if (proof.physicalOSClipboardVerified !== false) throw new Error('controlled terminal model cannot claim physical OS clipboard verification');
  if (proof.controlledHostClipboardModel !== true) throw new Error('PTY proof is missing controlled terminal host model scope');
}
