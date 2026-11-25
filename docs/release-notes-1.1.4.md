# Carthagent 1.1.4

Draft notes for the next stable update to 1.1.3. This release is not published
yet. Once published, `ctg update` on the stable channel will install it.
No profile, sign-in or session migration is planned.

The runtime code is unchanged from 1.1.3 (runtime patch v21). Runtime assets
are tied to each release version, so first launch may download and verify
the 1.1.4 runtime even if 1.1.3 is already cached.

## Fixes

- CLI session titles no longer split an emoji or another supplementary Unicode
  character at the 80-UTF-16-code-unit title limit. This applies to interactive,
  Ship and headless session creation.
  ([#318](https://github.com/B-icy/Carthagent/pull/318))
- Ship explains that plan artifacts are source, test, config and documentation
  roots, not generated directories such as `dist`. Individual generated files
  belong in outputs. Review guidance now spells out the capture ID, coverage,
  observed probes, explicit findings and limitations, and the returned finding
  IDs needed for resolutions. Verification gates are unchanged.
  ([#306](https://github.com/B-icy/Carthagent/pull/306))

## Diagnostics and reliability

- `ctg flags` lists feature flags, their state and the source of each decision.
  `--json` produces machine-readable output. Set `CTG_FLAG_<NAME>=on|off` or
  use `~/.carthagent/flags.json`. The native login dialog reads the same
  user settings despite running under a private runtime home directory.
- The `advanced-auth` flag exposes the Experiential API key option in the
  Carthagent Cloud login dialog. It defaults off; the existing
  `CARTHAGENT_ADVANCED_AUTH=1` switch still works.
- Uncaught CLI crashes save a local report. `ctg doctor` shows a recent-crash
  warning and a prefilled issue link; `ctg doctor --crash-report` prints the
  latest report. Reports are not uploaded automatically. Set
  `CTG_CRASH_REPORTS=0` to disable them. Review report contents before sharing.
- `CTG_LOG_LEVEL`, `CTG_LOG_FORMAT=json` and `CTG_LOG_FILE` control diagnostic
  logging. Logs go to stderr or a file, never stdout. Known secret patterns
  are redacted, but this is not a guarantee that every secret format is removed.
  `CARTHAGENT_DEBUG` now also enables debug logging.
- Update checks, runtime metadata requests and runtime downloads retry transient
  failures within the caller's existing time limit. Read-only requests use
  backoff; a per-host circuit breaker temporarily pauses repeated failures.
  Sign-in, billing, model calls and other POST requests are unchanged.
- Dashboard update-check failures and server errors now produce diagnostic logs.

These changes are included in
[#319](https://github.com/B-icy/Carthagent/pull/319).

## Evaluation reports

- Evaluation and benchmark reports count observed nested Code Mode operations
  and retain per-tool failures as `toolErrors`.
- Event fallback preserves observed calls after interruption or transcript-fetch
  failure. Tool IDs are scoped to each assistant message so reused provider IDs
  do not collapse separate calls.
- Input-only streaming is not counted as execution. A nested finish without an
  attributable result stays unknown rather than being reported as verified.

These are accounting fixes, not evidence of improved task success, speed or
cost. ([#305](https://github.com/B-icy/Carthagent/pull/305))

## For contributors

- Prettier formatting, stricter ESLint rules and checks for architecture,
  duplication, debt markers, unused dependencies and workspace dependency drift.
  Existing lint violations are baselined; new ones fail.
- Coverage thresholds, JUnit results, test and build timing budgets, test listing,
  profiling and credential-free QA smoke checks.
- Dashboard and Cloud OpenAPI specs, generated API documentation, `AGENTS.md`,
  a dev container and opt-in Git hooks (`npm run hooks:install`).
- Dependabot cooldowns, issue and PR templates, CODEOWNERS, release-note
  automation, CI alerts and release health monitoring.
- The post-publish health check waits for both npm and the update manifest.
  Automatic Droid review skips forks and runs without an available API key.
  Enabling it requires a `FACTORY_API_KEY` secret and the required Factory setup.

Dependency updates opened by Dependabot after these merges are not included.

"Verified" means the declared required checks passed against the current code.
It is not independent proof of task completeness or freedom from bugs. See the
[release preparation checklist](release-preparation-1.1.4.md) for pending
final-artifact and platform acceptance.
