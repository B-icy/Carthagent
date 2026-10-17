#!/usr/bin/env bash

# Shared ABBA driver used by the paired runner and its offline orchestration test.
register_paired_exit_cleanup() {
  trap "$1" EXIT
}

remove_paired_workdir() {
  local path="${1:-}"
  if [[ "$path" == /tmp/ctg-native-paired.* && "$path" != *..* ]]; then
    rm -rf -- "$path"
  fi
}

run_paired_abba() {
  local callback="$1" statuses_file="$2" guard_module="$3" interrupted_flag="$4"
  local label mode status exit_status
  for label in baseline-1 ctg-1 ctg-2 baseline-2; do
    case "$label" in
      baseline-*) mode=baseline ;;
      ctg-*) mode=ctg ;;
    esac
    set +e
    "$callback" "$label" "$mode"
    status=$?
    set -e
    # A callback may own richer failure reporting. If it did not record its
    # condition, guarantee a retained nonzero status before continuing ABBA.
    if ! awk -F '\t' -v name="$label" '$1 == name { found=1 } END { exit !found }' "$statuses_file" 2>/dev/null; then
      printf '%s\t%s\n' "$label" "$((status == 0 ? 1 : status))" >> "$statuses_file"
    fi
  done
  paired_exit_status="$(node --input-type=module - "$statuses_file" "$guard_module" "$interrupted_flag" <<'NODE'
import { readFileSync } from 'node:fs';
const { aggregateConditionExit } = await import(process.argv[3]);
const statuses = Object.fromEntries(readFileSync(process.argv[2], 'utf8').trim().split('\n').filter(Boolean).map(line => {
  const [name, status] = line.split('\t');
  return [name, Number(status)];
}));
process.stdout.write(String(aggregateConditionExit(statuses, process.argv[4] === '1')));
NODE
)"
}
