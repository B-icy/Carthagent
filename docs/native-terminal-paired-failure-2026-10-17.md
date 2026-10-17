# Native terminal paired attempt failure record — 2026-10-17

This is a sanitized failure summary, not performance acceptance evidence.

- Harness head: `198e66b47a00e2d8938b0e44be698cb6c0ffed26`.
- Frozen product source: `38ad06f7d439bc7c15b901f7b2c741b31486e93a`.
- Owned executable: OpenCode `2.0.32`, SHA-256
  `489b51816a77809e841310e80c88e834c28c19ad1639e12ba8a19f08b47ab607`.
- Dependency tree SHA-256:
  `a25d9aed67019a73dcf6e8a77746a043f4b76c633bbb02184350aaaa5d22c24d`.
- Window: 2026-10-17 18:15:41–18:16:54 UTC; requested order was baseline,
  CTG, CTG, baseline; 30 samples per condition.
- Aggregate runner exit: `1`.
- Retained artifact directory:
  `/tmp/opencode/ctg-native-terminal-paired-approved-20261017T181325Z`.

Both baseline fixture seeders failed during dependency identity validation
because the baseline's intentionally null plugin path was passed to `resolve`.
Both CTG fixtures reported native Carthagent active and passed its health probe,
but their PTY runs failed before samples because the readiness detector looked
for `Ask anything` instead of the product's native `Message carthagent…`
placeholder. Reports have `runStatus: failed`; no valid input or switch
percentiles/samples were produced. Preserve the raw private artifact directory
for audit, but do not copy fixture credentials or raw seeder logs into source
control.

These are two distinct harness defects. The current fix resolves baseline
provenance from the immutable execution root and uses the actual native editor
placeholder while retaining an exact changed-cell-at-origin assertion. A new
bounded readiness mode is diagnostic only and does not create latency samples.
It requires independent review and must not be run while authors/material work
is active without fresh operator permission. No ABBA rerun is authorized by
this failure record.

The acceptance record still has 50 ms input p95 and 150 ms warm-switch p95
targets. It defines no sustained-memory ceiling, reconnect/streaming reliability
target, or long-window duration. The existing short idle RSS/output observation
is descriptive only. A separate long-window design is documented in
`native-terminal-performance.md`; it needs a defined workload/acceptance policy
and an independently authorized quiet host window before execution.
