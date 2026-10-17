#!/usr/bin/env bash
set -euo pipefail

# Bounded, non-timed real integration readiness check. This starts only the
# disposable loopback fixture and a single PTY TUI; it does not run samples.
if [[ $# -ne 6 || ( "$6" != baseline && "$6" != ctg ) ]]; then
  printf 'Usage: %s SOURCE_CHECKOUT EXECUTION_SNAPSHOT_TAR HARNESS_WORKTREE BINARY MANIFEST baseline|ctg\n' "$0" >&2
  exit 2
fi
source_checkout="$(cd "$1" && pwd)"
execution_snapshot="$(realpath "$2")"
harness_worktree="$(cd "$3" && pwd)"
binary="$(realpath "$4")"
manifest="$(realpath "$5")"
mode="$6"
source_commit="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).sourceCommit)' "$manifest")"
snapshot_sha="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).sourceSnapshotSha256)' "$manifest")"
execution_sha="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).executionSnapshotSha256)' "$manifest")"
actual_snapshot_sha="$(sha256sum "$execution_snapshot" | awk '{print $1}')"
if [[ "$actual_snapshot_sha" != "$execution_sha" ]]; then
  printf 'Execution snapshot hash does not match retained manifest\n' >&2
  exit 1
fi
work="$(mktemp -d /tmp/ctg-native-readiness.XXXXXX)"
chmod 700 "$work"
ready="$work/ready"
seeder_log="$work/seeder.log"
server_pid=''
fixture=''
cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill -TERM "$server_pid" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$server_pid" 2>/dev/null || break; sleep 0.1; done
    kill -KILL "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [[ -n "$fixture" && -f "$fixture" ]]; then
    temp="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).temp)' "$fixture")"
    if [[ "$temp" == /tmp/ctg-native-fixture-* && "$temp" != *..* ]]; then rm -rf -- "$temp"; fi
  fi
  if [[ "$work" == /tmp/ctg-native-readiness.* && "$work" != *..* ]]; then rm -rf -- "$work"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
source_root="$work/source"
mkdir -p "$source_root"
tar -xf "$execution_snapshot" -C "$source_root"
deps="$(realpath "$source_checkout/node_modules")"
cp "$harness_worktree/tools/native-fixture.mjs" "$harness_worktree/tools/seed-native-switch-fixture.mjs" \
  "$harness_worktree/tools/native-paired-guards.mjs" "$harness_worktree/tools/test-native-terminal-performance.py" \
  "$source_root/tools/"
ln -s "$deps" "$source_root/node_modules"
mkdir -p "$source_root/plugins/carthagent/node_modules/@opencode"
ln -s "$deps/@opencode/plugin" "$source_root/plugins/carthagent/node_modules/@opencode/plugin"
seed=("$source_root/tools/seed-native-switch-fixture.mjs" "$source_root/plugins/carthagent" --serve "--ready-file=$ready")
expected=active
if [[ "$mode" == baseline ]]; then seed+=(--no-plugin); expected=absent; fi
CTG_PERF_MANIFEST="$manifest" NODE_PATH="$deps" CTG_OPENCODE_BIN="$binary" node "${seed[@]}" >"$seeder_log" 2>&1 &
server_pid=$!
for _ in $(seq 1 300); do
  if [[ -s "$ready" ]]; then break; fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    printf '%s readiness fixture seeder exited before ready (private log retained only until cleanup)\n' "$mode" >&2
    exit 1
  fi
  sleep 0.1
done
if [[ ! -s "$ready" ]]; then
  printf '%s readiness fixture timed out before ready\n' "$mode" >&2
  exit 1
fi
fixture="$(cat "$ready")"
CTG_PERF_EXPECT_PLUGIN="$expected" CTG_PERF_SOURCE_COMMIT="$source_commit" \
CTG_PERF_SOURCE_SNAPSHOT_SHA256="$snapshot_sha" NODE_PATH="$(realpath "$source_root/node_modules")" \
CTG_OPENCODE_BIN="$binary" python3 "$source_root/tools/test-native-terminal-performance.py" \
  --binary "$binary" --switch-fixture "$fixture" --samples 1 --readiness-only
printf 'Readiness passed for %s; no timed samples were run.\n' "$mode"
