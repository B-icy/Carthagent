## Summary

<!-- What changes for users or maintainers, in one or two sentences. -->

## Why

<!-- The problem, linked issue (Fixes #123) or decision this implements. -->

## Changes

<!-- The notable changes, grouped by area. Call out anything surprising. -->

## Verification

<!-- Exact commands you ran and their results. List the gates you skipped and why.
     "Tests pass" without commands is not verification. -->

- [ ] `npm run quality`
- [ ] Area gates (for example `npm run test:native-host`, `npm run test:python`, `npm run test:browser`):
- Skipped gates and reason:

## Evidence

<!-- UI changes: a real render or screenshot. TUI changes: an interactive terminal capture.
     Say whether someone actually inspected it. Delete this section if not applicable. -->

## Risk and rollback

<!-- What could break, who is affected, and how to undo it (revert, feature flag, runtime pin). -->

## Checklist

- [ ] Regression test added for behavior changes
- [ ] Docs and AGENTS.md updated where behavior or commands changed
- [ ] No secrets, tokens, real user data or credentials in code, logs or fixtures
- [ ] Labels set (type, area, and `breaking-change` or `release-notes: skip` if applicable)
