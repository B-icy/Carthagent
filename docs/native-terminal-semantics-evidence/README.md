# Native terminal semantics evidence

These are separate run records. Their `probeSha256`, source commit/dirty state,
binary path/version/SHA-256, and status fields identify exactly what each run
does and does not establish.

| Artifact | Status | Interpretation |
| --- | --- | --- |
| `controlled-host-model-selftest.json` | Model self-test pass | Parser/state-model only; not an OpenCode PTY run or native acceptance. |
| `final-binary-model-selftest.json` | Model self-test pass | Repeated model-only parser/state self-test recorded alongside this evidence set; not native acceptance. |
| `picker-previous-probe-pass.json` | Picker pass | Earlier picker Escape, restored composer, zero pre-prompt requests; retained without rerun. |
| `focused-clipboard-title-stale-binary.json` | Stale-binary observation | Selection/copy readbacks passed in the controlled host model, but binary `30a3bb65…` predates the final title patch. Do not use its title pass as acceptance evidence. Physical clipboard is not verified. |
| `layout-stale-binary-observation-not-accepted.json` | Incomplete | Reports a 40x12 render pass on the same stale binary, but clipboard checks did not run and title acceptance is superseded. Not the requested final-binary layout result. |
| `picker-latest-incomplete-attempt.json` | Incomplete attempt | Later picker invocation did not establish picker dismissal; it does not revoke the separately recorded earlier picker pass. |
| `final-binary-focused-85bb44a.json` | Focused native passes | Exact selected-substring and `/copy` payload/readbacks in the modeled OSC 52 host, exact prompt transport, and title restoration against the supplied final binary. This is not physical clipboard proof. |
| `final-binary-full-incomplete-85bb44a.json` | Incomplete | Full run on the supplied binary passed picker Escape, 40x12 layout, 18,047-byte Unicode paste, `/copy`, and title restoration, but its selection attempt did not produce an OSC 52 update. The focused rerun did. |
| `final-binary-layout-85bb44a.json` | Layout pass | Independent 40x12 render pass; selection and copy were intentionally not exercised in this lane. |
| `final-binary-layout-interactive-85bb44a.json` | Interactive narrow-layout pass | At 40x12, typed unique input, backspaced one character, opened and navigated the recent-sessions menu, cancelled with Escape, and verified the edited composer input returned. Not a model-picker test. |
| `final-binary-model-picker-unchanged-model-incomplete-85bb44a.json` | Incomplete / fail | The actual model picker was visible, but the harness did not establish navigation followed by Escape dismissal and unchanged state. Later request model names alone are not accepted as picker-state evidence. |
| `final-binary-picker-cancel-incomplete-85bb44a.json` | Incomplete | Standalone picker run did not identify a picker screen. The corrected full run did observe and pass Escape dismissal. |
| `current-acceptance-status.json` | Bounded multi-run acceptance | Summarizes only checks observed on the exact supplied binary; physical OS clipboard remains unverified. |

The supplied binary was `/tmp/opencode/ctg-final-runtime-build/resume-build/packages/cli/dist-ctg/cli-linux-x64/bin/opencode`, version `opencode v0.0.0-ctg.2.0.32`, SHA-256 `85bb44a65e8c185f4f33d41507d29acc77f2db0cdcb0103a14476021c8e43794`. Its adjacent package manifest identifies `@opencode/cli-linux-x64` version `0.0.0-ctg.2.0.32`. Evidence is split across runs because the full-run selection gesture was not stable. Treat the combined status as bounded PTY/model acceptance only; never infer physical OS clipboard acceptance from captured OSC 52 or the controlled host model.
