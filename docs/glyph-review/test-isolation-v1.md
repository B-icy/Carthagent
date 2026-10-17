# Spinner test import-order follow-up (v1)

The composed 81e test run exposed an import-order assumption in the spinner
assertion: `SPINNER_FRAMES` is initialized when its module is first imported,
so setting `CTG_TUI_GLYPHS` later in a test does not change that constant. The
production startup-time behavior is intentional and unchanged. The follow-up
patch, [`../patches/opencode-v2.0.32-glyph-spinner-test-isolation-v1.patch`](../patches/opencode-v2.0.32-glyph-spinner-test-isolation-v1.patch),
checks ASCII and Unicode startup values in separate Bun subprocesses with the
mode set in each child's environment before import.

Patch SHA-256:
`651f4d08959ed657c94fc77fb6af48992b928f2b63eb922719f34dcb38cd8f26`.

## Validation on Bun 1.4.2

- Glyph tests: 11 passed, 0 failed, 147 assertions.
- Combined glyph, plugin-keymap, and plugin-theme tests with a 60-second
  per-test timeout: 18 passed, 0 failed, 168 assertions.
- The same combined invocation with the suite's 30-second default had one
  plugin-keymap timeout; rerunning at 60 seconds passed. No production code or
  spinner initialization was changed.

The subprocess assertions set the selected mode before importing
`spinner-frames.ts`; this preserves and verifies the startup-time constant
contract in both ASCII and Unicode modes despite other test modules being able
to import the module earlier in the parent process.
