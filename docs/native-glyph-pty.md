# Owned OpenCode glyph PTY acceptance

`npm run test:native-glyph-pty` resolves the runtime through CTG's production
`resolveOpenCode` path, requires its identity to be CTG-owned, and verifies the
runtime provenance and executable digest before starting a TUI. The packaged
release manifest is the default trust root. To test an explicitly staged owned
artifact, provide both a staging root and an independently trusted release
manifest:

```sh
CTG_TEST_RUNTIME_ARTIFACT_ROOT=/path/to/owned-runtime \
CTG_TEST_RUNTIME_RELEASE_MANIFEST=/path/to/trusted-release.json \
CTG_GLYPH_ARTIFACT=/tmp/glyph-pty.json \
npm run test:native-glyph-pty
```

The explicit artifact preflight runs before the production resolver can execute
it. Do not set `CTG_OPENCODE_BIN` or `CTG_TEST_RUNTIME_SHA256`; either would
bypass the acceptance trust chain. The runner launches two full TUI sessions in
real PTYs, with isolated temporary home/config/data/state/cache/database and
project directories: one with `CTG_TUI_GLYPHS=ascii`, one with
`CTG_TUI_GLYPHS=unicode`. It stages (but does not submit) the exact text
`CTG_USER_TEXT 漢字 café → • − …` in the composer. No model provider is used.

Assertions concern a small, named set of static prompt chrome tokens (the
vertical prompt border and known chrome ellipsis, bullet, and minus mappings).
They do not require the whole screen to be ASCII: arbitrary Unicode user text is
checked as exact UTF-8 component echoes in the captured PTY stream (the compact
screen model does not implement wide-cell positioning), and its composer row is
excluded from the chrome-token checks.
The JSON artifact records the exact runtime version, compatibility version,
binary SHA-256, source/patch/lock provenance, production resolver identity,
mode-specific parsed screens, and captured-PTY digests. A PTY pass establishes
the exercised home composer frame only; it is not a claim that every TUI dialog,
shell result, tool group, or disclosure state was rendered.

Both spawned processes receive allowlisted environments. The Node resolver may
use `CTG_RUNTIME_GITHUB_TOKEN` while acquiring an unpublished draft runtime, but
the Python harness and each OpenCode PTY child receive only PATH/locale plus
fresh temporary profile paths and the explicit glyph mode. The optional release
token is never forwarded to the child TUI, model, or tools. No host account,
provider credential, network provider, performance, memory, or real clipboard
claim is part of this acceptance test.

The currently available `85bb44a65e8c185f4f33d41507d29acc77f2db0cdcb0103a14476021c8e43794`
runtime predates the glyph patch and may be used only as a negative control. Do
not report it as a glyph pass. Positive acceptance requires rerunning this
harness against the final combined runtime artifact and retaining its JSON
report.
