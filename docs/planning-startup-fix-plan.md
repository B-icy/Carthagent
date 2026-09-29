# Planning startup repair — design and author challenge

Reconstructed after the temporary worktree disappeared. Committed benchmark evidence remains unchanged. New persistent worktree: `/home/baissi/ctg-planning-startup`.

## Goal and scope

Pilot treatments consumed19–54 tools in discovery without a plan. Guide the model into an accurate initial contract sooner without dropping requirements or weakening gates. Provider timeouts remain a separate unresolved problem. No paid benchmark or automatic retry in this change.

## Design

- Pure `planning-guide.mjs`: short exact field guide, illustrative example tested with production validators, actionable reference diagnostics. Never synthesize/approve a user's plan.
- Pure `planning-discovery.mjs`: numeric branch-restored pre-plan checkpoint. After8 completed discovery results or2 blocked implementation attempts, recommend first plan or ONE focused unresolved question; after16 reads emphasize expanding discovery. Advisory only; necessary reads always remain available. Restore bounded numeric fields defensively. New user prompt starts a checkpoint; existing/informational plans suppress it.
- Extension composition: `delivery_design action=guide` works without plan, source fingerprint or workspace mutation. Short startup guidance replaces blanket instructions to read long docs. Checkpoints injected outbound only and persisted as numeric custom entries; no approvals/secrets/requirements stored there. Successful plan suppresses reminders.
- Deterministic validation: offending component/check/requirement references reported alongside allowed IDs. Preserve finding codes/severity, exact acceptance, user validators, blockers and approval policy.
- Jev semantic context: include existing check definitions, outputs and assumptions in both built-in adapters; judge scenario-to-check adequacy, not syntax. Same bounded input/output, opt-in, identity-bound3-attempt cap. Invalid plans cannot inspect or invoke Jev; schema repair costs zero calls. Document added external disclosure.

## Challenge (author review, not independent approval)

Hard discovery cutoff could force guessed designs: rejected. Automatic boilerplate scenarios could launder semantic quality: rejected. Probabilistic schema validation is unnecessary/unsafe: rejected. Do not expand a mandatory schema or repeat full examples each turn. Checkpoint classification is heuristic and cannot authorize anything. Restored state must come from active branch, not an unrelated newer branch. No reapproval on normal implementation edits. Advice bounds/timeouts/gates remain unchanged. More Jev context can hit64KB earlier; report unavailable rather than truncate exact obligations or retry. No claims these changes fix provider reliability or prove model improvement.

## Acceptance/tests

Guide example passes real validators and stays small. Unknown references remain blocking and actionable. Checkpoints survive compaction/restoration, reset on input, stop on plan, do not nag questions or block reads. Full extension loop guide -> bad schema -> repair -> captured valid plan -> local mock Jev -> self-review -> approval -> edit -> real check -> final diff review -> verified; assert no Jev before valid inspect and preserved exact obligations. Existing stale-source/blocker/user-validator suites remain green. Both adapters send new context unchanged, preserve no-mutation/bounds. Scripted installed-engine offline smoke if available verifies guide/checkpoint/tool pairing, not model efficacy. Focused tests then full quality; preserve all historical artifacts.
