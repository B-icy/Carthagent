# Review assurance

`pi2 review <pr>` launches one fresh reviewer, with a default 300-second subprocess timeout. `--timeout` accepts integers from 1 through 300. PR metadata lookups each have their own 30-second deadline; this is not a whole-command 300-second deadline.

Approval requires successful execution, a valid final verdict line, unchanged local source fingerprint, and the same remote PR head before and after review. Missing head identity fails closed. The source fingerprint has the same exclusions as delivery evidence; it is not a filesystem sandbox. Changes made and reverted during review cannot be detected by endpoint comparison.

Read-only behavior is currently an instruction, not enforced isolation. A reviewer may execute tools; use a disposable checkout with restricted credentials for untrusted repositories. Snapshot checks detect some mutations after the fact, not prevent them. The three-round repair limit is a workflow instruction, not a persistent cross-process quota. Do not describe it as enforced by the extension.

Review findings are model judgments, separate from test/lint/build evidence. They should identify severity, file and line, rationale, proposed resolution, and uncertainty. A valid verdict does not prove completeness, correctness, or that the reviewer inspected the intended diff. Local context can differ from the PR; the reviewer must use the PR diff as the authoritative change.
