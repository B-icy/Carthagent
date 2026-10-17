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

Warm-session-switch target is 150 ms. It remains **not measured**. The pinned
bundle's session-resume action is exposed through its native editor keybinding,
but fixture work has not yet verified a selector launch and destination render
from the same native session store. A PTY attempt did not show the selector, so
no selection-to-destination latency is reported. Do not substitute selector-
open time or RPC. Resolve and validate the native selector entry point before
enabling switch samples; then require 30 alternating selections and a unique
rendered destination marker.

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
run remains pending. The attempted switch path did not open the native selector
and produced no valid switch samples. Host load and available memory are now
captured at run start and end in JSON; rerun only in a controlled window after
the native session-selection route is verified.
