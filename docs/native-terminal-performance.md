# Native terminal performance probe

`npm run test:native-terminal-performance` is an **opt-in**, POSIX-only check
against the package-owned OpenCode 2.0.32 executable. Set `CTG_OPENCODE_BIN`
when the executable is outside `node_modules/@opencode/cli/bin/opencode.exe`.
It starts a disposable real PTY with the Carthagent plugin enabled and prints
JSON evidence. It is deliberately not in the default CI test script because
terminal scheduling and host load make latency thresholds unsuitable as a
flaky default gate.

The first-render/plugin warmup happens before the input clock starts. Each of
30 (minimum) literal keystrokes is timed from writing the key to observing a
new matching cell at the native editor placeholder's input origin in a parsed
VT screen. Arbitrary transcript/status text and other editor-row cells are not
accepted as an echo. This is a PTY key-to-render proxy, not a compositor/GPU
presentation timestamp. Input p95 target: 50 ms.

The JSON artifact includes run-start load average, CPU count, and host memory
availability so a loaded host is visible alongside latency samples. These
measurements remain sensitive to concurrent workloads; use an otherwise idle,
controlled host for comparisons, and do not attribute a paired delta to CTG
unless the run is actually paired/alternated on the same host window.

The harness also observes a bounded idle window (default 10 seconds, maximum
300 seconds), captures terminal-output bytes, and samples process RSS. The
default observation budgets are 64 KiB of output and 128 MiB RSS range. Output
is informational, not a failure by itself: OpenCode's native status clock can
legitimately redraw. RSS range is a short-window trend, not proof of a global
memory bound or leak-free long-running behavior. Use `--idle-seconds`,
`--idle-byte-limit`, and `--memory-growth-limit-mb` to make the measured window
and limits explicit. `--report path.json` saves the output.

Warm-session-switch target is 150 ms. The opt-in `--switch-fixture` mode uses
two prepopulated OpenCode sessions in the pinned host's disposable database,
opens the actual native Open Sessions menu (`open.menu`, bound to Ctrl+O in the
isolated profile), and times Enter acceptance to the selected session's unique
persisted assistant-history marker. It visits both histories before 30
alternating samples to warm them. It excludes menu-open/search time and does
not use RPC timing. Sessions must be in the same project because this build's
Open Sessions picker scopes session rows to the active project. Switch mode is
diagnostic-only; input p95 is not measured in that mode.

The separate `npm run test:native-performance` probe measures cached workspace
RPC only. Its samples must not be described as terminal input or session-switch
latency.

## Recorded host run (2026-10-17)

Earlier input figures (140.464 ms plugin-configured and 121.098 ms plugin-
disabled) are withdrawn as invalid: the old detector could match an arbitrary
terminal character rather than a changed cell in the editor. They are not
performance evidence. A separate 94.571 ms figure was taken under heavy
concurrent CI/build/test load (roughly 90% host RAM utilization per observation)
and is not a controlled measurement. Do not infer CTG overhead from the earlier
separate plugin-enabled/disabled values. After correcting the detector to
require a changed cell at the parsed editor input origin, a new 30-key
plugin-disabled run measured **181.782 ms p95** (294.085 ms max), missing the
50 ms target. That run was still under heavy system load (8 CPUs; start load
average 14.25/14.70/17.17; 4,130 MiB available memory; end load
14.25/14.68/17.14; 3,708 MiB available). It is valid evidence for that loaded
host window, not a controlled baseline. Idle observation was 1 second, 121 PTY
bytes, and 7.11 MiB process-tree RSS range. A controlled paired plugin/baseline
run remains pending. A separate native switch-only run successfully recorded
30 alternating same-project session changes. It measured **1,025.493 ms p95**
(1,391.240 ms max), missing the unchanged 150 ms target. The host was loaded:
8 CPUs; load 16.57/15.64/15.22 at start and 15.79/15.62/15.23 at end, with
3,914 MiB available memory at start and 4,467 MiB at end. The switch result is
valid for that loaded host window, not a controlled acceptance measurement.
Both sessions were previsited, and unique destination history markers were
checked before and after each actual selection. A follow-up switch-only run
completed under lower, though still non-idle, load: **573.526 ms p95**
(696.095 ms max), with load 6.50/6.18/9.84 at start and 8.62/6.70/9.94 at end;
available memory was 5,587 MiB at start and 5,199 MiB at end. Both runs miss
the 150 ms target; neither is a controlled acceptance measurement. Host load
and available memory are captured at start and end in JSON.
