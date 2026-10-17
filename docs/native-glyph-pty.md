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
`CTG_GLYPH_PAYLOAD 漢字 café → • − …` in the composer. The paired PTY parser
tracks East Asian wide-cell width and combining marks locally to this probe; it
requires the entire exact ordered payload on the rendered prompt row. No model
provider is used.

Assertions cover one known static chrome mapping: the startup logo must be the
ASCII wordmark in ASCII mode and the block-art wordmark in Unicode mode. The
complete arbitrary Unicode user payload must independently match, in order, on
the rendered composer row. The composer row itself is excluded from startup-logo
classification. This is not coverage of prompt borders, ellipses, bullets,
separators, other dialogs, shell output, or tool-group disclosure.
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

The historical negative-control runtime with SHA-256
`85bb44a65e8c185f4f33d41507d29acc77f2db0cdcb0103a14476021c8e43794` predates the
glyph patch; it rendered the Unicode startup logo in ASCII mode and was rejected.
That artifact is no longer available here and its result is not a glyph pass.
Positive acceptance requires rerunning this harness against the final combined
runtime artifact and retaining its JSON report.

Pure Unicode cell-width, composer-payload, and child-environment helper code is
in `tools/native-glyph-helpers.py`, which has no OS-specific PTY imports. Its
unit tests run on supported platforms when Python is available (select an
interpreter with `PYTHON`). The actual PTY execution runner remains Unix-only;
this does not claim Windows PTY acceptance.
