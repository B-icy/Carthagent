Fix decimal-money precision and validation across this billing monorepo without breaking existing consumers. Inspect the packages/call sites and baseline tests first; use structured dependency-aware delivery steps and refine the same task with delivery_revise when discoveries change the plan. Add regressions that fail before the implementation, then verify them after the fix.

Requirements:
- Use exact integer cents internally, without dependencies. Accept finite numeric amounts and ordinary signed decimal strings with at most two decimal places. Reject blanks, scientific/hex notation strings, booleans, null, arrays, objects, nonfinite values, excess precision and unsafe integer-cent totals.
- Keep totalAmounts returning a number. Keep API count and numeric total; add totalDecimal formatted with exactly two decimals. Empty lists total 0.00, and refunds work.
- Invalid entries/amounts must produce API status 400 with a JSON error string, not leak an exception. The actual CLI must return JSON and exit 1 for those errors, and handle paths with spaces/Unicode.
- Preserve CSV header/order/format and apply the same money validation rather than a separate permissive conversion.
- Preserve existing tests, add meaningful regression/boundary/public-path tests, run npm run quality and the injected user-owned validator.
- Update README with contracts, compatibility and rollout/rollback considerations. Declare and write artifacts/migration-report.json with summary, affected consumers, test evidence, and limitations; inspect its contents before finishing.

Only edit files inside this repository. Do not modify evaluator scripts/manifests outside it, read credentials, install dependencies, commit changes, or deploy. Finish verified only when requirements and fresh checks actually pass; otherwise report blocked honestly. This is a bounded live planning trial, not a request to modify Carthagent itself.
