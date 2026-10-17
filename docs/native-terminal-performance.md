# Native terminal performance probe

`npm run test:native-terminal-performance` is an **opt-in**, POSIX-only check
against the package-owned OpenCode 2.0.32 executable. Set `CTG_OPENCODE_BIN`
when the executable is outside `node_modules/@opencode/cli/bin/opencode.exe`.
It starts a disposable real PTY with the Carthagent plugin enabled and prints
JSON evidence. It is deliberately not in the default CI test script because
terminal scheduling and host load make latency thresholds unsuitable as a
flaky default gate.

The first-render/plugin warmup happens before the input clock starts. Each of
30 (minimum) literal keystrokes is timed from writing the key to observing its
matching character in terminal output; this is a PTY key-to-render-echo proxy,
not a compositor/GPU presentation timestamp. Input p95 target: 50 ms.

The harness also observes a bounded idle window (default 10 seconds, maximum
300 seconds), captures terminal-output bytes, and samples process RSS. The
default observation budgets are 64 KiB of output and 128 MiB RSS range. Output
is informational, not a failure by itself: OpenCode's native status clock can
legitimately redraw. RSS range is a short-window trend, not proof of a global
memory bound or leak-free long-running behavior. Use `--idle-seconds`,
`--idle-byte-limit`, and `--memory-growth-limit-mb` to make the measured window
and limits explicit. `--report path.json` saves the output.

Warm-session-switch target is 150 ms, but is only scored if the harness can
prove a switch between two pre-populated sessions in distinct project roots
through a real keyboard action and observe a post-switch marker. OpenCode
2.0.32's TUI in this compatibility package does not expose native session
tabs: the native session chooser is a selector and `/resume` is owned by CTG's
local-session dialog. The current probe therefore reports switch latency as
**not measured** instead of substituting server RPC or selector-open latency.
Do not treat `overallTargetsMet: false`/`null` for this dimension as evidence
that the target passed. A follow-up switch adapter must add independently
prepared root-specific session fixtures and a verifiable rendered marker.

The separate `npm run test:native-performance` probe measures cached workspace
RPC only. Its samples must not be described as terminal input or session-switch
latency.

## Recorded host run (2026-10-17)

On the available Linux host using the owned `@opencode/cli` 2.0.32 binary and
30 samples, the plugin-configured PTY run observed **140.464 ms p95** (max
140.757 ms), missing the 50 ms target. Its 3-second idle window emitted 0 PTY
bytes and the TUI process RSS ranged 197.26–197.96 MiB (0.70 MiB range).
A separate plugin-disabled PTY run observed **121.098 ms p95** (max 357.1 ms)
and a 59.35 MiB process-tree RSS range over its 3-second window, also missing
the input target. These were separate, short runs rather than a randomized,
paired experiment; the 19.4 ms difference is **not** attributable to CTG.
Neither run measured warm switching. These are host observations, not a pass.
