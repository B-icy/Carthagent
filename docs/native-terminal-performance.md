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
presentation timestamp. It includes the harness's PTY `select`/read, screen
parsing, and evidence-detection path. Per-sample polling and VT-feed work are
recorded as observer instrumentation; they are not subtracted or treated as a
compositor estimate. Input p95 target: 50 ms.

The JSON artifact includes run-start load average, CPU count, and host memory
availability so a loaded host is visible alongside latency samples. These
measurements remain sensitive to concurrent workloads; use an otherwise idle,
controlled host for comparisons, and do not attribute a paired delta to CTG
unless the run is actually paired/alternated on the same host window.

The harness also observes a bounded idle window (default 10 seconds, maximum
300 seconds), captures terminal-output bytes, and reports separate process-tree
RSS for the TUI and its owned fixture server when available. Output is
informational, not a failure by itself: OpenCode's native status clock can
legitimately redraw. This brief RSS range is descriptive only. No product-defined
sustained-memory ceiling exists, and a short idle sample cannot establish a
long-term bound or absence of leaks. `--idle-seconds` and `--idle-byte-limit`
control the brief observation; `--memory-growth-limit-mb` is opt-in and only
reports comparison with an explicitly operator-approved diagnostic threshold.
It does not affect `overallTargetsMet`. `--report path.json` saves the output.

### Workspace render acceptance and bounded-memory evidence

The native compatibility acceptance additionally requires cached `/ctg-workspace`
load within 300 ms and bounded plugin memory. The existing workspace benchmark
is RPC-only and does not establish visible TUI completion. Paired acceptance
must include a separate real-PTY `/ctg-workspace` path: resolve slash
autocomplete first, prove the command is staged in the editor and no completion
dialog is active, then anchor the start timestamp to the submission Enter write;
stop only when the command's plugin
route has opened and a required, exact workspace-render success sentinel is
parsed from the PTY. The sentinel and setup must prove a post-submit render
phase—not slash autocomplete, the old session screen, a dialog, or a blank
workspace. A missing sentinel/blank render is a hard failure with no latency
metric. Record select/read, VT-feed, parser, and detection observer durations;
report them without subtraction. The 300 ms maximum applies to the complete
Enter-to-render observation.

The strict post-submit workspace-render probe is implemented, but remains
unverified on the live UI while the workspace pane is blank/being fixed. It must
fail closed until the route and data-backed sentinel actually render.

For bounded memory release evidence, the parent has proposed—not inherited from
the original compatibility document—this explicit 30-minute offline comparison
gate: baseline and CTG each have a 5-minute warmup, followed by 25 minutes of
1-second RSS observations; record TUI process-tree RSS and owned-server
process-tree RSS independently and combined. Proposed, reviewable calculations
use combined TUI+owned-server RSS, with each condition run serially under the
same finite replay trace: warm each condition for 5 minutes, then collect 1,500
planned one-second slots over exactly 25 minutes. Index slots from a monotonic
start (`n = 0..1499`); preserve each actual monotonic timestamp and sample
lateness. A sample later than 250 ms after its planned slot, duplicate slot,
missing process/PID, or missing sample is a failure; never substitute zero,
interpolate, drop, or pair runs by exact wall-clock timestamp. Compare matching
slot indices, not jittered timestamps. Define block 0 as slots 0..299 and the
final block as 1200..1499. Let `B0` and `C0` be the medians of combined RSS in
block 0 for baseline and CTG. For every slot define baseline-adjusted excess
growth `D[n] = (CTG[n] - C0) - (baseline[n] - B0)`. The retained-growth gate
proposal is `max(D[n]) <= 128 MiB` over all slots. The observable-plateau
proposal is `median(D[1200..1499]) - median(D[0..299]) <= 32 MiB`. Preserve raw
TUI/server/combined series, planned and actual monotonic timestamps, lateness,
host conditions, workload request/reconnect/error counts, and cleanup evidence.
RSS is a process-tree RSS proxy; summing process RSS may double-count shared
pages and is not physical unique memory.
These finite-window release criteria are engineering observations, not
mathematical long-term memory guarantees. Parent/product review must approve the
formula, workload, and failure policy before execution; this is plan review
only, not authorization to run the workload. The replay must be a finite,
checked-in deterministic sequence of loopback streaming requests with fixed
payload sizes, chunk sizes, chunk pacing, connection close/reconnect positions,
and exact request count. Baseline and CTG must replay byte-for-byte equivalent
request traces; record per-request bytes/chunks/timing and reconnect outcomes.
Any mismatch or failure,
missed sample, or threshold exceedance is reported as failure, not dropped. Do
not run beside active authors; no such timed observation is authorized here.

Warm-session-switch target is 150 ms. The opt-in `--switch-fixture` mode uses
two prepopulated OpenCode sessions in the pinned host's disposable database,
opens the actual native Open Sessions menu (`open.menu`, bound to Ctrl+O in the
isolated profile), and times Enter acceptance to the selected session's unique
persisted assistant-history marker. It visits both histories before 30
alternating samples to warm them. It excludes menu-open/search time and does
not use RPC timing. Timing is Enter write through PTY polling/read, VT parsing,
and parsed destination-marker observation—not compositor/GPU presentation.
Per-sample observer polling and parse work are reported, never subtracted.
Sessions must be in the same project because this build's
Open Sessions picker scopes session rows to the active project. Switch mode is
diagnostic-only; input p95 is not measured in that mode.

The separate `npm run test:native-performance` probe measures cached workspace
RPC only. Its samples must not be described as terminal input, session-switch,
or `/ctg-workspace` visible-render latency. The actual paired PTY benchmark must
include the strict post-submit UI-render sample described above.

## Recorded host run (2026-10-17)

The authorized 2026-10-17 controlled-window attempt is **failed diagnostic
evidence only** (runner aggregate exit 1; no valid latency samples). Retained
artifacts are at
`/tmp/opencode/ctg-native-terminal-paired-approved-20261017T181325Z`. Its
manifest records frozen source `38ad06f7d439bc7c15b901f7b2c741b31486e93a`,
owned CLI 2.0.32, and the selected dependency identity. Both baseline passes
failed before measurement because dependency provenance attempted to resolve
the null plugin path. Both CTG passes passed raw native inventory/health checks,
then failed readiness because the detector expected `Ask anything`, while the
actual native editor hint is `Message carthagent…`. The remediation adds a
strict bounded readiness mode and actual loopback fixture script; no latency
threshold or editor-cell criterion is relaxed. Their reports are marked
failed and contain no valid input/switch sample arrays. Do not quote them as
latency evidence. Private seeder logs and fixture credentials remain only in
the mode-0700 artifact directory; do not copy them into source control.

### Authorized non-timed readiness follow-up

On the clean product checkout `2d8efc1561f26ae40d1f29cd329a8c01c2bd4c72`
(tree `c116b9b3337f64bc70a8bc11b2eedf9478a1294a`), the explicitly authorized
upstream-CLI-only readiness diagnostic used OpenCode `2.0.32`, binary SHA-256
`489b51816a77809e841310e80c88e834c28c19ad1639e12ba8a19f08b47ab607`, and
initially matched dependency tree
`a25d9aed67019a73dcf6e8a77746a043f4b76c633bbb02184350aaaa5d22c24d`.
Baseline passed: native inventory reported Carthagent absent and the seeded
fixture session rendered; `timedSamplesRun` was false. CTG inventory/health
activation passed, but strict editor readiness failed: neither the completed
fixture session nor a separately seeded empty session produced the required
`Message carthagent…` input anchor. No keystroke echo or timing metric was
recorded. Later, while authors were active, the dependency-install hash changed
to `ed47a3314dff75ea40151544f900da80c57dcfce82356da577cecd09ba728937` (while
the lockfile and pinned CLI hash remained unchanged), so further CTG attempts
were stopped. The upstream-binary check verifies the harness fix only; it does
not establish final shipping-runtime identity or acceptance. Preserve the exact
baseline result and CTG fail-closed outcome; do not call the latter a pass.

Native fixtures now carry the shared runtime identity record separately from
the compatibility version: compatibility remains exactly `2.0.32`, while the
runtime version is matched exactly against both `server.info.version` and the
CTG health RPC. The fixture first runs the product resolver/identity API with
the same options object, then independently verifies the selected bytes and
identity through the approved shared native-test loader against the trusted
release record (`lib/opencode/runtime-release.json` or the explicit developer
path `CTG_TEST_RUNTIME_RELEASE_MANIFEST`). For explicit staging roots, the
loader verifies path/hash/provenance before the product resolver can execute
the binary. The adjacent `ctg-runtime.json` is provenance only, never a trust
source; `CTG_TEST_RUNTIME_SHA256` is passed to the verifier as an explicit
developer hash input. No owned final-runtime readiness result is claimed yet.

The runner stopped with aggregate status 1 as designed. A malformed timestamp
format in the preliminary window-recording command occurred before the runner
was invoked; identities/load were rechecked and recorded before the one
authorized attempt.

No rerun is authorized by this record. The non-timed readiness check below is
for regression validation only; another ABBA needs fresh independent review
and a new controlled quiet-window confirmation.

After a fresh review approves the readiness changes, a bounded non-timed real
integration readiness check can be invoked with the archived execution snapshot
and retained manifest (it does not run the ABBA or latency samples):

```bash
tools/test-native-terminal-readiness.sh \
  /tmp/opencode/ctg-product-integration \
  /tmp/opencode/ctg-native-terminal-paired-approved-20261017T181325Z/execution-snapshot.tar \
  "$HARNESS_WORKTREE" \
  /tmp/opencode/ctg-product-integration/node_modules/@opencode/cli/bin/opencode.exe \
  /tmp/opencode/ctg-native-terminal-paired-approved-20261017T181325Z/manifest.json \
  baseline
```

Use `ctg` instead of `baseline` to verify active plugin inventory and health.
This command starts one disposable loopback fixture and performs only a
placeholder-anchored key echo/backspace check. It is not latency or long-window
acceptance evidence, and must not be run concurrently with authors/material
workloads without the operator's permission.

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
30 alternating same-project session changes. This is a diagnostic observation,
not acceptance evidence. It measured **1,025.493 ms p95**
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

## Controlled paired assessment (run only in a scheduled quiet window)

Do not start while CI, builds, UI lint, native evaluations, or other material
workloads are active. The parent/operator must confirm the quiet window first.
The exact pinned executable used by the runbook is
`/tmp/opencode/ctg-product-integration/node_modules/@opencode/cli/bin/opencode.exe`;
the script refuses to fall back to `~/.opencode` or a system `opencode`.

From this worktree, after the operator confirms a quiet window and fresh review
accepts the current harness head, resolve the current integration checkout HEAD
to a full commit SHA, verify that exact source tree and physical dependency
identity have been reviewed for acceptance, then run (replace the window ID
with a unique label):

```bash
WINDOW_ID=2026-10-17-evening # choose a unique scheduled-window label
export CTG_OPENCODE_BIN=/tmp/opencode/ctg-product-integration/node_modules/@opencode/cli/bin/opencode.exe
export CTG_SOURCE_ROOT=/tmp/opencode/ctg-product-integration
export CTG_SOURCE_COMMIT="$(git -C "$CTG_SOURCE_ROOT" rev-parse HEAD)"
test "${#CTG_SOURCE_COMMIT}" -eq 40
git -C "$CTG_SOURCE_ROOT" show -s --format='%H %T %ci %s' "$CTG_SOURCE_COMMIT"
sha256sum "$CTG_SOURCE_ROOT/package-lock.json"
export SAMPLES=30
export OUTPUT_DIR="/tmp/opencode/ctg-native-terminal-paired-${WINDOW_ID}"
bash tools/run-native-terminal-paired.sh
```

Do not reuse a previously selected source SHA when the product branch advances.
The command resolves the exact checkout HEAD at scheduling time; record that
full SHA, tree ID, dirty status, package-lock hash, owned binary hash/version,
physical dependency-install realpath/tree hash, and generated source/execution
archive hashes from `manifest.json`. The runner verifies the committed source
lockfile against the physical install and requires `CTG_SOURCE_COMMIT` to equal
the integration checkout HEAD observed by the runner before archive creation or
fixture work. Selecting an older commit is rejected even if its package lockfile
matches. The runner executes the archived current commit plus the reviewed
harness overlay, never mutable checkout source. A source/lock/install identity
mismatch fails before fixture creation. Do not treat an older archived tree or
an old benchmark run as current product acceptance evidence.

Requirements are Bash, `setsid`, Node.js, Python 3 with POSIX `pty`, and
`@opencode/client` in the pinned integration install. The runner archives the
selected immutable source commit, verifies its lockfile against the physical
dependency install containing the selected executable, and overlays only the
reviewed harness files in a disposable `/tmp` execution snapshot. It does not
write source or dependencies into the integration checkout. Its private output
directory is mode 0700 because seeder logs contain temporary loopback
credentials. The manifest retains binary version/hash, source commit/tree and
snapshot hashes, source checkout state, lockfile hash, dependency realpath and
full install tree hash, and source/harness component hashes. The script creates
independent disposable baseline and composed-production-CTG
profiles/databases with equivalent same-project fixture sessions, a loopback-
only provider, unique persisted assistant markers, and a 36x120 PTY. Before
each TUI measurement, the raw native plugin inventory must report `carthagent` active
for CTG and absent for baseline; the report records that observed state. An
activation/setup error, incomplete source archive, or identity mismatch fails
the condition and cannot produce performance metrics. It runs
ABBA (`baseline-1`, `ctg-1`, `ctg-2`, `baseline-2`); each run visits both
destinations before its measured alternating selections. Each condition gets
at least 30 switch and 30 input samples, plus one excluded input warmup. It
records per-sample UTC and monotonic start/end times, verifies the changed
input cell and its restoration to the native empty-editor placeholder after
each backspace, verifies each unique destination marker, records select/poll,
PTY read, VT-feed and predicate-detection observer counters, and retains
failures. A failed sample stays in the artifact and prevents that condition's
target from being marked met. One-second load-average and `MemAvailable`
observations run through each sample window (including the two session warmups
and input warmup). Reports and seeder logs are retained under `OUTPUT_DIR`;
disposable profiles and local servers are cleaned up on exit.

The harness leaves the thresholds unchanged (50 ms input p95, 150 ms switch
p95). These are terminal-to-parsed-PTY-screen proxies, not compositor timing;
do not subtract observer measurements or claim such a correction. A short RSS
range remains descriptive only and is not included in overall target acceptance;
there is no product memory ceiling in this assessment. Preserve the
existing **573.526 ms p95** switch observation as a loaded-host diagnostic;
the paired run, too, is diagnostic unless the operator confirms the controlled
window and independent review accepts the evidence. Deliberate fixed waits are
outside sample clocks: up to 500 ms initial frame drain, a 50 ms maximum PTY
poll quantum while preparing the picker, 1 ms maximum poll quantum while
awaiting rendered evidence, event-driven wait for the editor to return to the
empty placeholder after backspace, and the separate 10-second post-sample idle
observation. No fixed sleep is inside a switch or key-to-screen interval; PTY
read/poll/parser overhead is inside and reported. Do not subtract that observer
work.

Estimated wall time once scheduled: roughly **5–9 minutes**, including the full
dependency-tree identity scans during setup and fixture validation, fixture
seeding and four ABBA passes (typically 35–60 seconds of timed switching/input
per pass, plus startup, session seeding, and idle observation). Allow **up to 12
minutes**; abort rather than overlap a newly started material workload.
