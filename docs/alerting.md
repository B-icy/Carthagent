# Alerting

Carthagent has one maintainer. Alerts are GitHub issues, so they reach the maintainer through the normal GitHub notification channels, stay searchable, and close automatically when the problem goes away. There is no pager. Severity comes from priority labels defined in `.github/labels.json`.

## Alerts

| Alert | Source | Trigger | Labels | Deduplication | Auto-close |
| --- | --- | --- | --- | --- | --- |
| CI failure | `.github/workflows/ci-alert.yml` running `tools/ci-alert.mjs` | `CI`, `Release`, `Accept draft runtime release`, `Build or publish CTG-owned OpenCode runtime` or `Sync labels` concludes `failure`, `timed_out` or `startup_failure` on the default branch, or in any `workflow_dispatch` run | `source: ci-alert`, `priority: P1`, `area: ci` | One open issue per workflow, matched by the hidden marker `<!-- carthagent-alert:ci:<workflow name> -->`. Repeated failures add a comment that names the run, head SHA, failed jobs and the first failing steps | On the next successful tracked run of the same workflow |
| Release health | `.github/workflows/release-health.yml` running `tools/release-health.mjs` | Any check fails on the 6-hourly or manually dispatched run (see [deployment-observability.md](deployment-observability.md)) | `source: release-health`, `priority: P0`, `area: release` | One open issue, matched by `<!-- carthagent-alert:release-health -->`. Comments are added only when the set of failing checks or the release tag changes (tracked in a hidden signature marker) | On the next fully healthy run |
| Crash report | Users, via the crash report issue form, prefilled by `ctg doctor` | A user files the report | `bug`, `source: crash-report`, `status: triage` | Manual, by crash fingerprint | Manual |

Runs triggered by pull requests never alert, including runs from forks, and neither do cancelled or skipped runs. A run whose head repository is not this repository is ignored even when its branch is called `main`.

A failing run of the `Release health` workflow does not create a CI alert, because it already reports through its own issue. If the health script itself crashes and leaves no report, the run fails with a red status and no issue is opened. GitHub's default failed-workflow email to the maintainer covers that case.

## Routing

1. The workflow opens or updates an issue as `github-actions[bot]`.
2. The maintainer (`@B-icy`, the CODEOWNER for `/.github/`) gets a notification when **Watch** on the repository is set to **All Activity**, or to **Custom** with **Issues** checked. Set this once. GitHub sends the notification by email and in the GitHub Mobile app if those channels are enabled under *Settings → Notifications*.
3. For mobile push on P0 only, add a GitHub Mobile custom notification filter or an email rule that matches `priority: P0` or `[Release health failing`.
4. GitHub's own *Actions* notifications email the actor of a failed manually dispatched run, and the user who last changed the cron schedule for a failed scheduled run. This is the fallback when the alerting workflow itself is broken.

## Severity

| Priority | Meaning | Response target | Alerts that use it |
| --- | --- | --- | --- |
| `priority: P0` | Users cannot install or update, or a release is inconsistent across GitHub, npm, the manifest and the installer | Acknowledge within 1 hour while awake. Fix or roll back the same day ([rollback](deployment-observability.md#rollback)) | Release health |
| `priority: P1` | The main branch or a release workflow is broken, which blocks the next release | Next working session, and before any release | CI failure |
| `priority: P2` | Degraded behavior with a workaround | Normal triage | Manual |
| `priority: P3` | Polish | Backlog | Manual |

Raise an alert's priority by hand when needed. For example, a `Release` failure partway through publishing is effectively P0.

## Acknowledge and close

- **Acknowledge** by assigning yourself and leaving a comment that names the suspected cause. Do not remove the `source:` label or edit the hidden marker in the issue body. The automation uses the marker to find the issue, and a missing marker leads to a duplicate.
- **Resolve** by fixing the cause and letting the next tracked run close the issue. For CI, that is the next successful push to `main` or dispatch of the same workflow. For release health, it is the next scheduled run, or run `gh workflow run release-health.yml` to recheck immediately.
- **Close manually** only for a false alarm or a problem that has already gone away. A closed issue is never reopened. The next failure opens a new issue, which keeps each incident separate.
- **Silence a noisy alert** by fixing or disabling the failing workflow. Do not close the issue repeatedly.

## Add a new alert

1. Put the decision logic in a pure function in `tools/<name>.mjs`. It takes the observation and the currently open alert issue (or `null`) and returns `{ type: 'create' | 'comment' | 'close' | 'none', ... }`. Use `tools/ci-alert.mjs` (one comment per event) and `tools/release-health.mjs` (comment only on change, with `signatureMarker`) as templates.
2. Reuse `tools/github-issues.mjs`: `alertMarker(key)` for deduplication, `findAlertIssue(issues, key)` to locate the open issue, `createIssueClient({ repo })` for `gh api` calls, and `applyAlertAction(client, action)` to perform the action.
3. Pick labels: always a `source:` label (add a new one to `.github/labels.json` if needed), one `priority:` label from the table above, and one `area:` label.
4. Unit test the decision function offline with fixture data in `tests/<name>.test.mjs`. Do not make network calls in tests.
5. Add a workflow with the narrowest permissions (`issues: write`, plus `actions: read` only if it reads run data). Pass event data to the script as a file or through environment variables, never by interpolating `${{ }}` into shell. Check out the default branch, never code from the triggering run.
6. Add a row to the alerts table above.
7. To watch an additional workflow for CI failures, add its exact `name:` to `workflows:` in `.github/workflows/ci-alert.yml`.
