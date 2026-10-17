#!/usr/bin/env bash

# Configure fixture-seeder identity selection for an explicitly selected owned
# runtime. The PTY client may still receive --binary directly; the Node fixture
# must resolve through the owned-root path so runtimeIdentity does not treat an
# ambient CTG_OPENCODE_BIN override as an upstream selection.
configure_native_owned_runtime() {
  local binary="$1" owned_root="$2" release_manifest="$3"
  if [[ ! -x "$binary" ]]; then
    printf 'Owned native runtime is missing or not executable: %s\n' "$binary" >&2
    return 2
  fi
  if [[ ! -f "$release_manifest" ]]; then
    printf 'Trusted CTG runtime release record is required: %s\n' "$release_manifest" >&2
    return 2
  fi
  local runtime_helper="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/native-runtime-identity.mjs"
  local canonical_binary canonical_root canonical_manifest
  canonical_binary="$(realpath "$binary")"
  canonical_root="$(realpath "$owned_root")"
  canonical_manifest="$(realpath "$release_manifest")"
  if ! node --input-type=module - "$runtime_helper" "$canonical_binary" "$canonical_root" "$canonical_manifest" >/dev/null <<'NODE'
import { readFile } from 'node:fs/promises';
const { loadNativeTestRuntime } = await import(process.argv[2]);
const identity = await loadNativeTestRuntime({
  binary: process.argv[3],
  ownedRoot: process.argv[4],
  expectedManifest: JSON.parse(await readFile(process.argv[5], 'utf8')),
  env: process.env,
});
process.stdout.write(`${JSON.stringify(identity)}\n`);
NODE
  then
    printf 'Owned native runtime failed trusted identity verification; refusing to launch fixture seeder.\n' >&2
    return 2
  fi
  export CTG_OWNED_OPENCODE_RUNTIME="$canonical_root"
  export CTG_TEST_RUNTIME_RELEASE_MANIFEST="$canonical_manifest"
  unset CTG_OPENCODE_BIN
}
