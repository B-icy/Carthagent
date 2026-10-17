#!/usr/bin/env bash
set -u -o pipefail

# Controlled-window paired diagnostic: baseline, CTG, CTG, baseline (ABBA).
# This script intentionally does not decide whether the host is quiet; the
# operator must schedule it after competing CI/build/evaluation work has ended.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
binary="${CTG_OPENCODE_BIN:-/tmp/opencode/ctg-product-integration/node_modules/@opencode/cli/bin/opencode.exe}"
samples="${SAMPLES:-30}"
output_root="${OUTPUT_DIR:-/tmp/opencode/ctg-native-terminal-paired-$(date -u +%Y%m%dT%H%M%SZ)}"

if [[ ! -x "$binary" ]]; then
  printf 'Pinned executable is missing or not executable: %s\n' "$binary" >&2
  exit 2
fi
binary_node_modules="$(cd "$(dirname "$binary")/../../.." && pwd)"
if [[ ! -d "$binary_node_modules/@opencode/client" ]]; then
  printf 'Pinned dependency tree is missing @opencode/client: %s\n' "$binary_node_modules" >&2
  exit 2
fi
if [[ "$samples" -lt 30 ]]; then
  printf 'SAMPLES must be at least 30 (got %s)\n' "$samples" >&2
  exit 2
fi
mkdir -p "$output_root"
output_root="$(cd "$output_root" && pwd)"
if [[ -n "$(find "$output_root" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  printf 'Output directory must be empty and unique: %s\n' "$output_root" >&2
  exit 2
fi
umask 077
chmod 700 "$output_root"
set -e

work="$(mktemp -d /tmp/ctg-native-paired.XXXXXX)"
runner="$work/runner"
mkdir -p "$runner/tools" "$runner/plugins"
cp "$repo_root/tools/native-fixture.mjs" "$repo_root/tools/seed-native-switch-fixture.mjs" "$runner/tools/"
cp -a "$repo_root/plugins/carthagent" "$runner/plugins/carthagent"
ln -s "$binary_node_modules" "$runner/node_modules"
active_fixture=''
active_pid=''
cleanup() {
  if [[ -n "$active_pid" ]]; then
    kill -TERM "$active_pid" 2>/dev/null || true
    wait "$active_pid" 2>/dev/null || true
  fi
  if [[ -n "$active_fixture" && -f "$active_fixture" ]]; then
    python3 -c 'import json,shutil,sys; shutil.rmtree(json.load(open(sys.argv[1]))["temp"], ignore_errors=True)' "$active_fixture"
  fi
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

export CTG_OPENCODE_BIN="$binary"
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
  ready="$work/$label-ready"
  log="$output_root/$label-seeder.log"
  local seed_args=("$runner/tools/seed-native-switch-fixture.mjs" "$runner/plugins/carthagent" --serve "--ready-file=$ready")
  if [[ "$mode" == "baseline" ]]; then
    seed_args+=(--no-plugin)
  elif [[ "$mode" != "ctg" ]]; then
    printf 'Unknown condition: %s\n' "$mode" >&2
    return 2
  fi
  printf 'Seeding %s at %s\n' "$label" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$output_root/order.log"
  node "${seed_args[@]}" >"$log" 2>&1 &
  active_pid=$!
  if ! wait_ready "$ready" "$active_pid" "$label" "$log"; then
    return 1
  fi
  active_fixture="$(cat "$ready")"
  cp "$active_fixture" "$output_root/$label-fixture.json"
  printf 'Starting %s measurement at %s\n' "$label" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$output_root/order.log"
  set +e
  python3 "$repo_root/tools/test-native-terminal-performance.py" \
    --binary "$binary" --switch-fixture "$active_fixture" --samples "$samples" \
    --host-sample-interval 1 --idle-seconds 10 \
    --report "$output_root/$label.json" >"$output_root/$label.stdout.log" 2>"$output_root/$label.stderr.log"
  status=$?
  set -e
  printf '%s\t%s\t%s\n' "$label" "$status" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$output_root/order.log"
  kill -TERM "$active_pid" 2>/dev/null || true
  wait "$active_pid" 2>/dev/null || true
  active_pid=''
  python3 -c 'import json,shutil,sys; shutil.rmtree(json.load(open(sys.argv[1]))["temp"], ignore_errors=True)' "$active_fixture"
  active_fixture=''
  return 0
}

cat >"$output_root/manifest.json" <<EOF
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "binary": "$binary",
  "expectedHostVersion": "2.0.32",
  "repo": "$repo_root",
  "order": ["baseline-1", "ctg-1", "ctg-2", "baseline-2"],
  "samplesPerRun": $samples,
  "warmup": "one input key excluded; both switch destinations visited before measured alternating switches",
  "terminal": "36 rows x 120 columns",
  "thresholds": {"inputP95Ms": 50, "switchP95Ms": 150},
  "measurementScope": "keypress or Enter through select/read/VT parsing to parsed PTY screen evidence; not compositor/GPU presentation; no observer-overhead subtraction",
  "hostSampling": "one-second load-average and MemAvailable observations throughout each run's switch/input window",
  "pairedConditions": "one condition server at a time; fresh disposable profiles/databases with equivalent same-project session titles/prompts/markers; same pinned binary and 36x120 PTY",
  "acceptance": "diagnostic until operator confirms controlled window and independent review; thresholds unchanged"
}
EOF

run_one baseline-1 baseline
run_one ctg-1 ctg
run_one ctg-2 ctg
run_one baseline-2 baseline
printf 'Paired diagnostic artifacts: %s\n' "$output_root"
