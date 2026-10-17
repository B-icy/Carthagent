# Owned TUI `/clear` behavioral proof

`tools/test-owned-visual-clear.py` runs a disposable Linux/POSIX PTY against an
explicitly selected, trusted-preflighted CTG-owned staging artifact and an
offline loopback provider. It seeds two durable sessions, invokes the native
TUI `/clear` command through slash autocomplete and Enter, and verifies the
parsed terminal screen, durable conversational messages, continued prompting,
an unaffected neighboring session, and restoration of session A's presentation
cutoff after reopening it.

The proof is intentionally narrow: it demonstrates visual transcript clearing
for the tested owned staging artifact and no deletion of conversational
messages. It does not test GUI/compositor presentation or the unrelated
`session.revert.clear` endpoint. The PTY runner strips
`CTG_RUNTIME_GITHUB_TOKEN` case-insensitively before child execution, exercises
that boundary with fake values only, and uses the production
`runtimeEnvironment()` profile builder for the isolated TUI.

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
