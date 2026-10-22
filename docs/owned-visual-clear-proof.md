# Owned TUI `/clear` behavioral proof

`tools/test-owned-visual-clear.py` runs a disposable Linux/POSIX PTY against an
explicitly selected, trusted-preflighted CTG-owned staging artifact and an
offline loopback provider. It seeds two durable sessions, invokes the native
TUI `/clear` command through slash autocomplete and Enter, and verifies the
parsed terminal screen, durable conversational messages, continued prompting,
an unaffected neighboring session, and restoration of session A's presentation
cutoff after reopening it. A same-length, uncleared control session must show
its old marker and follow-up marker together at the same PTY dimensions and
initial viewport, ruling out ordinary scrolling as the explanation. The proof
also reads the TUI's isolated `transcript-presentation.json` state and checks
the exact cutoff message ID before and after reopening.

The proof is intentionally narrow: it demonstrates visual transcript clearing
for the tested owned staging artifact and no deletion of conversational
messages. It does not test GUI/compositor presentation or the unrelated
`session.revert.clear` endpoint. The PTY runner uses explicit child-environment
allowlists, so it does not forward ambient credentials (including any case
variant of `CTG_RUNTIME_GITHUB_TOKEN`) or read/print their values. Unit tests
exercise rejection with fake values only. The runner uses the production
`runtimeEnvironment()` profile builder for the isolated TUI, then restricts
every spawned process to a small explicit environment allowlist. The fixture,
preflight and API bridge receive only allowlisted path/locale inputs plus
synthetic local fixture credentials; no ambient credential, profile, agent,
or Node preload variables are inherited. Unit tests inject fake ambient
credential names and assert they are not forwarded.

Run with a trusted release manifest and selected runtime artifact:

```sh
python3 tools/test-owned-visual-clear.py \
  --binary /path/to/owned-root/cli-linux-x64/bin/opencode \
  --owned-root /path/to/owned-root \
  --release-manifest /path/to/trusted/runtime-release.json
```

The helper verifies trusted release metadata, artifact provenance, exact
runtime version, and executable digest before starting OpenCode. Compatibility
and runtime versions are reported separately.
