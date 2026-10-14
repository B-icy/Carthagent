# Review the outcome, not just the parts

Delivery review captures tracked changes and the contents of new text source files.
Dependency, cache and output directories use the fingerprint's shared directory
exclusions. The receipt lists that scope explicitly. Binary additions carry a
digest and require an appropriate viewer; they are not visual evidence. Large
receipts remain available through the full capture path, and excessive new files
fail explicitly instead of silently losing source. Git-ignored files are outside
the new-file capture; include relevant ignored sources in an explicit manual review.

For changes connecting components, select a few checks that demonstrate the
connection the user relies on. A game needs input/camera/movement agreement; a
form needs submission/persistence agreement. A valid screenshot file or passing
physics test does not demonstrate those connections. Local changes still need
only relevant focused checks: this is not an extra mandatory planning loop.

`coverage` accepts optional `status: "demonstrated" | "unverified"`. Use
`unverified` when assertions do not establish a requirement. Such gaps and all
submitted findings are saved with stable IDs. A failed review record returns
`recorded:false` and unresolved findings, invalidates earlier review evidence,
and persists through both CLI and HTTP entry points. Empty findings, recapture,
session restore, and plan revision do not erase them.

Resolve a finding with `resolutions:[{id,change,evidence}]` on a current capture
after checks pass. Explain the repair or concrete evidence that the original
requirement is met. An environment limitation is not a resolution of untested
core behavior. If it cannot be demonstrated, finish blocked and describe what
did pass. The finding and resolution history is retained in the review evidence.

These are traceability safeguards, not a semantic correctness oracle: assertions
and resolutions remain model-authored. Existing clients may omit coverage status,
but cannot erase previously recorded findings by omitting them.

## Outcome contracts for larger changes

Plans may opt into experimental top-level `outcomes` with `id`, exact
`requirement`, real `entrypoint`, externally `observable` result, explicit
`substitutions`, a plausible `missedFailure`, and linked non-static `checks`.
No task is automatically enrolled based on component count. Standard
plans without a declared architecture should still use outcomes for substantial
changes; automatic inference of complexity is not claimed.

Build and exercise a thin real execution path early. At final review, each outcome
needs `{id,check,observation,challenge,status}`. The harness binds it to the actual
fresh passing check receipt. A missing record or unrelated check cannot verify;
an explicit unverified result creates a persistent finding. Outcome IDs and
requirement ownership cannot be dropped during plan revision. A successful
alternate mode is not evidence for the normal entrypoint. External dependencies
may be isolated, but resulting substitutions must remain visible.

The harness validates linkage and persistence. It does not execute prose,
understand every assertion, or prove that a model-authored challenge actually
exercises the claimed behavior. Live evaluation remains necessary.
