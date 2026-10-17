#!/usr/bin/env bash
set -u -o pipefail

# Controlled-window paired diagnostic: baseline, CTG, CTG, baseline (ABBA).
# This script intentionally does not decide whether the host is quiet; the
# operator must schedule it after competing CI/build/evaluation work has ended.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
binary="${CTG_OPENCODE_BIN:-/tmp/opencode/ctg-product-integration/node_modules/@opencode/cli/bin/opencode.exe}"
source_root="${CTG_SOURCE_ROOT:-/tmp/opencode/ctg-product-integration}"
source_commit="${CTG_SOURCE_COMMIT:-}"
samples="${SAMPLES:-30}"
output_root="${OUTPUT_DIR:-/tmp/opencode/ctg-native-terminal-paired-$(date -u +%Y%m%dT%H%M%SZ)}"

if [[ ! -x "$binary" ]]; then
  printf 'Pinned executable is missing or not executable: %s\n' "$binary" >&2
  exit 2
fi
if [[ -z "$source_commit" ]]; then
  printf 'Set CTG_SOURCE_COMMIT to the reviewed immutable integration commit.\n' >&2
  exit 2
fi
if [[ ! "$source_commit" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'CTG_SOURCE_COMMIT must be a full 40-character immutable commit SHA.\n' >&2
  exit 2
fi
source_root="$(cd "$source_root" && pwd)"
source_head="$(git -C "$source_root" rev-parse HEAD)"
source_dirty="$(git -C "$source_root" status --porcelain=v1)"
if ! git -C "$source_root" cat-file -e "$source_commit^{commit}"; then
  printf 'Selected immutable source commit is unavailable: %s\n' "$source_commit" >&2
  exit 2
fi
binary="$(realpath "$binary")"
binary_node_modules="$(realpath "$source_root/node_modules")"
if [[ "$binary" != "$binary_node_modules/@opencode/cli/bin/opencode.exe" || ! -d "$binary_node_modules/@opencode/client" ]]; then
  printf 'Binary must be the executable from the selected source snapshot dependency install. binary=%s deps=%s\n' "$binary" "$binary_node_modules" >&2
  exit 2
fi
source_lock_sha256="$(git -C "$source_root" show "$source_commit:package-lock.json" | sha256sum | awk '{print $1}')"
installed_lock_sha256="$(sha256sum "$source_root/package-lock.json" | awk '{print $1}')"
if [[ "$source_lock_sha256" != "$installed_lock_sha256" ]]; then
  printf 'Selected source commit lockfile differs from the physical dependency install lockfile.\n' >&2
  exit 2
fi
install_manifest="$(git -C "$source_root" show "$source_commit:plugins/carthagent/package.json")"
if ! grep -q '"@opencode/plugin": "2.0.32"' <<<"$install_manifest"; then
  printf 'Selected integration source does not carry the expected native plugin dependency.\n' >&2
  exit 2
fi
if [[ "$samples" -lt 30 ]]; then
  printf 'SAMPLES must be at least 30 (got %s)\n' "$samples" >&2
  exit 2
fi
umask 077
mkdir -p "$output_root"
output_root="$(cd "$output_root" && pwd)"
if [[ -n "$(find "$output_root" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  printf 'Output directory must be empty and unique: %s\n' "$output_root" >&2
  exit 2
fi
chmod 700 "$output_root"
set -e

work="$(mktemp -d /tmp/ctg-native-paired.XXXXXX)"
runner="$work/runner"
mkdir -p "$runner/source"
source_archive="$output_root/source-$source_commit.tar"
git -C "$source_root" archive --format=tar "$source_commit" > "$source_archive"
source_archive_sha256="$(sha256sum "$source_archive" | awk '{print $1}')"
tar -xf "$source_archive" -C "$runner/source"
ln -s "$binary_node_modules" "$runner/source/node_modules"
mkdir -p "$runner/source/plugins/carthagent/node_modules/@opencode"
ln -s "$binary_node_modules/@opencode/plugin" "$runner/source/plugins/carthagent/node_modules/@opencode/plugin"
cp "$repo_root/tools/native-fixture.mjs" "$repo_root/tools/seed-native-switch-fixture.mjs" \
  "$repo_root/tools/native-paired-guards.mjs" "$repo_root/tools/test-native-terminal-performance.py" "$runner/source/tools/"
execution_archive="$output_root/execution-snapshot.tar"
tar -C "$runner/source" --exclude=node_modules --exclude='*/node_modules' --exclude='**/node_modules' -cf "$execution_archive" .
source_snapshot_sha256="$(sha256sum "$execution_archive" | awk '{print $1}')"
binary_sha256="$(sha256sum "$binary" | awk '{print $1}')"
source_tree="$(git -C "$source_root" rev-parse "$source_commit^{tree}")"
binary_version="$("$binary" --version | awk '{print $2}' | sed 's/^v//')"
if [[ "$binary_version" != 2.0.32 ]]; then
  printf 'Expected owned OpenCode 2.0.32 binary, observed %s\n' "$binary_version" >&2
  exit 2
fi
source_component_sha256="$(cd "$runner/source" && find lib plugins/carthagent -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"
harness_component_sha256="$(cd "$runner/source" && sha256sum tools/native-fixture.mjs tools/seed-native-switch-fixture.mjs tools/native-paired-guards.mjs tools/test-native-terminal-performance.py | sha256sum | awk '{print $1}')"
node --input-type=module - "$runner/source/tools/native-paired-guards.mjs" "$binary_node_modules" "$runner/source/package.json" "$runner/source" > "$work/dependency-packages.json" <<'NODE'
const { hashDependencyPackages } = await import(process.argv[2]);
process.stdout.write(JSON.stringify(hashDependencyPackages(process.argv[3], process.argv[4], process.argv[5])));
NODE
dependency_packages_json="$(cat "$work/dependency-packages.json")"
dependency_install_json="$(node --input-type=module - "$runner/source/tools/native-paired-guards.mjs" "$binary_node_modules" <<'NODE'
const { hashDependencyInstall } = await import(process.argv[2]);
process.stdout.write(JSON.stringify(hashDependencyInstall(process.argv[3])));
NODE
)"
dependency_install_sha256="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).treeSha256)' "$dependency_install_json")"
active_fixture=''
active_pid=''
active_pid_label=''
active_run_pid=''
statuses="$work/condition-status.tsv"
interrupted=0
cleanup() {
  if [[ -n "$active_run_pid" ]]; then
    if [[ -n "$active_pid" ]]; then
      printf 'Interrupted condition %s; retaining artifacts and marking failed.\n' "$active_pid" >> "$output_root/interrupt.log"
      interrupted=1
      printf 'interrupted\t1\n' >> "$statuses"
    fi
    kill -TERM "$active_run_pid" 2>/dev/null || true
    kill -TERM -- "-$active_run_pid" 2>/dev/null || true
    run_group="$(ps -o pgid= -p "$active_run_pid" | tr -d ' ')"
    if [[ -n "$run_group" ]]; then pkill -TERM -g "$run_group" 2>/dev/null || true; fi
    for _ in $(seq 1 50); do
      kill -0 "$active_run_pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL "$active_run_pid" 2>/dev/null || true
    if [[ -n "${run_group:-}" ]]; then pkill -KILL -g "$run_group" 2>/dev/null || true; fi
    wait "$active_run_pid" 2>/dev/null || true
    active_run_pid=''
  fi
  if [[ -n "$active_pid" ]]; then
    label_for_failure="${active_pid_label:-unknown}"
    printf '%s\t1\t%s\n' "$label_for_failure" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$output_root/order.log"
    printf '%s\t1\n' "$label_for_failure" >> "$statuses"
    interrupted=1
    kill -TERM -- "-$active_pid" 2>/dev/null || kill -TERM "$active_pid" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 "$active_pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL -- "-$active_pid" 2>/dev/null || kill -KILL "$active_pid" 2>/dev/null || true
    wait "$active_pid" 2>/dev/null || true
    active_pid=''
    active_pid_label=''
  fi
  if [[ -n "$active_fixture" && -f "$active_fixture" ]]; then
    temp_path="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).temp)' "$active_fixture")"
    if [[ "$temp_path" == /tmp/ctg-native-fixture-* && "$temp_path" != *..* ]]; then rm -rf -- "$temp_path"; fi
  fi
  rm -rf "$work"
}
on_int() { interrupted=1; exit 130; }
on_term() { interrupted=1; exit 143; }
trap cleanup EXIT
trap on_int INT
trap on_term TERM

export CTG_OPENCODE_BIN="$binary"
export CTG_PERF_SOURCE_COMMIT="$source_commit"
export CTG_PERF_SOURCE_DIR="$runner/source"
export CTG_PERF_SOURCE_SNAPSHOT_SHA256="$source_snapshot_sha256"
export CTG_PERF_EXPECT_PLUGIN=''
export CTG_PERF_MANIFEST="$output_root/manifest.json"
export NODE_PATH="$binary_node_modules"
export CTG_PERF_DEPENDENCY_INSTALL_SHA256="$dependency_install_sha256"
wait_ready() {
  local file="$1" pid="$2" label="$3" log="$4"
  for _ in $(seq 1 300); do
    [[ -s "$file" ]] && return 0
    if ! kill -0 "$pid" 2>/dev/null; then
      printf '%s fixture seeder exited; see %s\n' "$label" "$log" >&2
      return 1
    fi
    sleep 0.1
  done
  printf 'Timed out waiting for %s fixture; seeder log: %s\n' "$label" "$log" >&2
  return 1
}

run_one() {
  local label="$1" mode="$2" status ready log
  active_pid_label="$label"
  ready="$work/$label-ready"
  log="$output_root/$label-seeder.log"
  local seed_args=("$runner/source/tools/seed-native-switch-fixture.mjs" "$runner/source/plugins/carthagent" --serve "--ready-file=$ready")
  if [[ "$mode" == "baseline" ]]; then
    seed_args+=(--no-plugin)
  elif [[ "$mode" != "ctg" ]]; then
    printf 'Unknown condition: %s\n' "$mode" >&2
    return 2
  fi
  printf 'Seeding %s at %s\n' "$label" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$output_root/order.log"
  CTG_PERF_MANIFEST="$output_root/manifest.json" setsid node "${seed_args[@]}" >"$log" 2>&1 &
  active_pid=$!
  if ! wait_ready "$ready" "$active_pid" "$label" "$log"; then
    return 1
  fi
  active_fixture="$(cat "$ready")"
  active_temp="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).temp)' "$active_fixture")" || return 1
  if [[ "$active_temp" != /tmp/ctg-native-fixture-* || "$active_temp" == *..* ]]; then
    printf 'Refusing to clean a fixture outside the native disposable-temp prefix: %s\n' "$active_temp" >&2
    return 1
  fi
  if ! python3 -c 'import json,sys; f=json.load(open(sys.argv[1])); assert f["roots"]["alpha"] == f["roots"]["bravo"]; assert f["sessions"]["alpha"]["directory"] == f["sessions"]["bravo"]["directory"]; assert f["sessions"]["alpha"]["id"] != f["sessions"]["bravo"]["id"]; assert f["sessions"]["alpha"]["marker"] != f["sessions"]["bravo"]["marker"]' "$active_fixture"; then
    printf 'Paired sessions are not equivalent same-project destinations.\n' >&2
    return 1
  fi
  if ! node --input-type=module - "$active_fixture" "$output_root/$label-fixture.json" "$output_root/manifest.json" "$runner/source/tools/native-paired-guards.mjs" "$mode" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const { verifySnapshotIdentity, assertPluginCondition } = await import(process.argv[5]);
const f = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const manifest = JSON.parse(readFileSync(process.argv[4], 'utf8'));
verifySnapshotIdentity(manifest, f.provenance, { verifyArtifactFiles: true });
const expectedActive = process.argv[6] === 'ctg';
if (expectedActive && (f.pluginHealth?.hostVersion !== '2.0.32' || f.pluginHealth?.protocol !== 1 || f.pluginHealth?.directoryMatches !== true)) {
  throw new Error('CTG plugin health RPC was not validated for this fixture');
}
const checked = assertPluginCondition(f.pluginInventory, expectedActive);
if (checked.observed !== f.pluginObservation?.observed) throw new Error('Plugin state changed while producing fixture metadata');
const safe = { roots: f.roots, sessions: f.sessions, pluginObservation: f.pluginObservation,
  pluginInventory: f.pluginInventory, pluginHealth: f.pluginHealth, provenance: f.provenance };
writeFileSync(process.argv[3], JSON.stringify(safe, null, 2) + '\n', { mode: 0o600 });
NODE
  then
    return 1
  fi
  printf 'Starting %s measurement at %s\n' "$label" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$output_root/order.log"
  if ! setsid -w true; then
    printf 'setsid is required to guarantee interrupt cleanup of the measurement process tree.\n' >&2
    return 1
  fi
  set +e
  CTG_PERF_EXPECT_PLUGIN="$([[ "$mode" == ctg ]] && printf active || printf absent)" setsid python3 "$runner/source/tools/test-native-terminal-performance.py" \
    --binary "$binary" --switch-fixture "$active_fixture" --samples "$samples" \
    --host-sample-interval 1 --idle-seconds 10 \
    --report "$output_root/$label.json" \
    >"$output_root/$label.stdout.log" 2>"$output_root/$label.stderr.log" &
  active_run_pid=$!
  wait "$active_run_pid"
  status=$?
  active_run_pid=''
  set -e
  printf '%s\t%s\t%s\n' "$label" "$status" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$output_root/order.log"
  kill -TERM "$active_pid" 2>/dev/null || true
  kill -TERM -- "-$active_pid" 2>/dev/null || true
  for _ in $(seq 1 50); do
    kill -0 "$active_pid" 2>/dev/null || break
    sleep 0.1
  done
  kill -KILL -- "-$active_pid" 2>/dev/null || kill -KILL "$active_pid" 2>/dev/null || true
  wait "$active_pid" 2>/dev/null || true
  active_pid=''
  active_pid_label=''
  temp_path="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).temp)' "$active_fixture")"
  if [[ "$temp_path" == /tmp/ctg-native-fixture-* && "$temp_path" != *..* ]]; then
    rm -rf -- "$temp_path" || status=1
  else
    printf 'Unsafe fixture cleanup path %s\n' "$temp_path" >&2
    status=1
  fi
  active_fixture=''
  printf '%s\t%s\n' "$label" "$status" >> "$statuses"
  return 0
}

run_condition() {
  local label="$1" mode="$2" before_count log
  log="$output_root/$label-seeder.log"
  before_count=0
  [[ -f "$statuses" ]] && before_count="$(wc -l < "$statuses")"
  set +e
  run_one "$label" "$mode"
  local condition_status=$?
  set -e
  if [[ -f "$statuses" ]] && [[ "$(wc -l < "$statuses")" -gt "$before_count" ]]; then return 0; fi
  if [[ "$condition_status" -eq 0 ]]; then
    printf '%s\t1\n' "$label" >> "$statuses"
    return 0
  fi
  printf '%s\t1\t%s\n' "$label" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$output_root/order.log"
  printf '%s\t1\n' "$label" >> "$statuses"
  if [[ -f "$log" ]]; then cat "$log" >> "$output_root/$label.stderr.log"; fi
  printf 'Condition %s seeder or activation failed; logs retained.\n' "$label" >> "$output_root/$label.stderr.log"
  if [[ -n "$active_pid" ]]; then
    kill -TERM "$active_pid" 2>/dev/null || true
    kill -TERM -- "-$active_pid" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 "$active_pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL -- "-$active_pid" 2>/dev/null || kill -KILL "$active_pid" 2>/dev/null || true
  wait "$active_pid" 2>/dev/null || true
  active_pid=''
  active_pid_label=''
  fi
  if [[ -z "$active_fixture" ]]; then
    ready_path="$work/$label-ready"
    if [[ -s "$ready_path" ]]; then active_fixture="$(cat "$ready_path")"; fi
  fi
  if [[ -n "$active_fixture" && -f "$active_fixture" ]]; then
    temp_path="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).temp)' "$active_fixture")" || temp_path=''
    if [[ "$temp_path" == /tmp/ctg-native-fixture-* ]]; then rm -rf -- "$temp_path"; fi
    active_fixture=''
  fi
  printf 'Condition %s failed before producing a complete run; continuing ABBA.\n' "$label" | tee -a "$output_root/$label.stderr.log"
  return 0
}

cat >"$output_root/manifest.json" <<EOF
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "binary": "$binary",
  "binaryVersion": "$binary_version",
  "binarySha256": "$binary_sha256",
  "expectedHostVersion": "2.0.32",
  "sourceCheckout": "$source_root",
  "sourceCheckoutHead": "$source_head",
  "sourceCheckoutDirty": "$([[ -n "$source_dirty" ]] && printf true || printf false)",
  "sourceCheckoutDirtyStatus": "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$source_dirty")",
  "sourceCheckoutStatusSha256": "$(printf '%s' "$source_dirty" | sha256sum | awk '{print $1}')",
  "sourceCommit": "$source_commit",
  "sourceTree": "$source_tree",
  "sourceDirty": "false",
  "sourceSnapshotTar": "$source_archive",
  "sourceArchiveSha256": "$source_archive_sha256",
  "executionSnapshotTar": "$execution_archive",
  "executionSnapshotSha256": "$source_snapshot_sha256",
  "sourceSnapshotSha256": "$source_snapshot_sha256",
  "packageLockSha256": "$source_lock_sha256",
  "installedPackageLockSha256": "$installed_lock_sha256",
  "dependencyNodeModulesRealpath": "$binary_node_modules",
  "dependencyInstallSha256": "$dependency_install_sha256",
  "dependencyInstallRealpath": "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).realpath)' "$dependency_install_json")",
  "dependencyPackages": $dependency_packages_json,
  "harnessWorktree": "$repo_root",
  "harnessCommit": "$(git -C "$repo_root" rev-parse HEAD)",
  "harnessDirty": "$(if [[ -n "$(git -C "$repo_root" status --porcelain=v1)" ]]; then printf true; else printf false; fi)",
  "harnessSourceManifestSha256": "$harness_component_sha256",
  "order": ["baseline-1", "ctg-1", "ctg-2", "baseline-2"],
  "samplesPerRun": $samples,
  "warmup": "one input key excluded; both switch destinations visited before measured alternating switches",
  "terminal": "36 rows x 120 columns",
  "thresholds": {"inputP95Ms": 50, "switchP95Ms": 150},
  "measurementScope": "keypress or Enter through select/read/VT parsing to parsed PTY screen evidence; not compositor/GPU presentation; no observer-overhead subtraction",
  "hostSampling": "one-second load-average and MemAvailable observations throughout each run's switch/input window",
  "pairedConditions": "one condition server at a time; fresh disposable profiles/databases with equivalent same-project session titles/prompts/markers; same pinned binary and 36x120 PTY; CTG loaded from complete selected source archive",
  "pluginRequirement": "the raw native plugin.list inventory must show carthagent active plus health RPC for CTG; no carthagent id or namespace for baseline; state is observed, never inferred from the mode flag",
  "sourceComponentSha256": "$source_component_sha256",
  "harnessComponentSha256": "$harness_component_sha256",
  "acceptance": "diagnostic until operator confirms controlled window and independent review; thresholds unchanged"
}
EOF

node --input-type=module - "$output_root/manifest.json" "$runner/source/tools/native-paired-guards.mjs" <<'NODE'
import { readFileSync } from 'node:fs';
const { assertSnapshotProvenance } = await import(process.argv[3]);
const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
assertSnapshotProvenance(manifest, { verifyArtifactFiles: true });
NODE

run_condition baseline-1 baseline
run_condition ctg-1 ctg
run_condition ctg-2 ctg
run_condition baseline-2 baseline
set +e
exit_status="$(node --input-type=module - "$statuses" "$runner/source/tools/native-paired-guards.mjs" "$interrupted" <<'NODE'
import { readFileSync } from 'node:fs';
const { aggregateConditionExit } = await import(process.argv[3]);
const statuses = Object.fromEntries(readFileSync(process.argv[2], 'utf8').trim().split('\n').filter(Boolean).map(line => {
  const [name, status] = line.split('\t');
  return [name, Number(status)];
}));
process.stdout.write(String(aggregateConditionExit(statuses, process.argv[4] === '1')));
NODE
)"
set -e
printf 'Paired diagnostic artifacts: %s (aggregate exit %s)\n' "$output_root" "$exit_status"
exit "$exit_status"
