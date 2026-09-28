# Uniform infrastructure restart (v2)

Original frozen tasks and evaluators: original-freeze.json, commit 7087423. No task/evaluator changes between attempts. All v1 runs are retained at ../deepseek-jev-v1, including the partial plain voxel candidate and eight zero-tool failures. The initial gateway hid the root cause behind its sanitized generic failure. Separate tiny diagnostic requests succeeded afterward; no candidate repair or external scores were returned to a generator.

Restart announced to user before beginning. Changes are runner root v2, candidate ceiling $2.84 (was $3), extra sanitized error class/code/stage receipts, and stop-the-matrix on the first gateway stopped condition instead of spending startup requests on the remaining arms. Full matrix order is unchanged. The first v2 run is launched individually for early diagnosis; subsequent runs only proceed if infrastructure remains healthy. No copying v1 candidate files into v2.

Worst-case accounting for v1: known actual $0.048990234 plus 9 unresolved $0.15 reservations = $1.398990234. Nine v2 ceilings of $2.84 = $25.56. Combined $26.958990234 <= original $27 candidate ceiling. Tiny diagnostic calls are separate smoke expense, within the original $0.10 allowance. Reservations are conservative local limits, not an OpenRouter account-level cap.

This is a transparent all-arm infrastructure restart, not another statistically independent replicate or a discarded bad model result. Retain both attempts and report v1 failures. No further automatic restarts authorized by this protocol.
