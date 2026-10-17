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
  export CTG_OWNED_OPENCODE_RUNTIME="$(realpath "$owned_root")"
  export CTG_TEST_RUNTIME_RELEASE_MANIFEST="$(realpath "$release_manifest")"
  unset CTG_OPENCODE_BIN
}
