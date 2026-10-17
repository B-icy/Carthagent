# Native terminal semantics evidence

These are separate run records. Their `probeSha256`, source commit/dirty state,
binary path/version/SHA-256, and status fields identify exactly what each run
does and does not establish.

| Artifact | Status | Interpretation |
| --- | --- | --- |
| `controlled-host-model-selftest.json` | Model self-test pass | Parser/state-model only; not an OpenCode PTY run or native acceptance. |
| `picker-previous-probe-pass.json` | Picker pass | Earlier picker Escape, restored composer, zero pre-prompt requests; retained without rerun. |
| `focused-clipboard-title-stale-binary.json` | Stale-binary observation | Selection/copy readbacks passed in the controlled host model, but binary `30a3bb65…` predates the final title patch. Do not use its title pass as acceptance evidence. Physical clipboard is not verified. |
| `layout-stale-binary-observation-not-accepted.json` | Incomplete | Reports a 40x12 render pass on the same stale binary, but clipboard checks did not run and title acceptance is superseded. Not the requested final-binary layout result. |
| `picker-latest-incomplete-attempt.json` | Incomplete attempt | Later picker invocation did not establish picker dismissal; it does not revoke the separately recorded earlier picker pass. |
| `current-acceptance-status.json` | Incomplete | Current review summary: preserve the earlier picker pass; mark layout and final-binary selection/copy/title unresolved. |

The final author binary path/hash has not yet been supplied. Once available,
rerun only the missing native acceptance lanes against that exact executable.
Keep unresolved outcomes explicit, and never infer physical OS clipboard
acceptance from captured OSC 52 or the controlled host model.
