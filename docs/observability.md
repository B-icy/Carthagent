# Observability and resilience

This page covers what the `ctg` CLI and the dashboard server record about their own behavior, where it is stored, and how failures reach the issue tracker. Release-level monitoring is in [deployment-observability.md](deployment-observability.md).

Nothing described here sends data over the network. Logs and crash reports stay on the machine; a crash only reaches GitHub if the user opens the prefilled issue and submits it.

## Logging

`lib/logger.mjs` provides a structured logger. Modules create one with a component name:

```js
import { getLogger } from './logger.mjs';
const log = getLogger('update');
log.debug('Passive update check failed; keeping the cached release', { channel, error });
const sessionLog = log.child({ sessionId }); // bound context on every line
```

| Variable | Values | Default |
| --- | --- | --- |
| `CTG_LOG_LEVEL` | `debug`, `info`, `warn`, `error`, `silent` | `warn` for the CLI, `info` for the dashboard server |
| `CARTHAGENT_DEBUG` | `1`, `true`, `yes`, `on`, `debug` | When set and `CTG_LOG_LEVEL` is not, the level is `debug` |
| `CTG_LOG_FORMAT` | `pretty` or `json` | `pretty` |
| `CTG_LOG_FILE` | A file path | Unset. When set, log lines are appended to this file as JSON lines (mode `0600`) **instead of** stderr |

Rules the logger enforces:

- It never writes to stdout. stdout carries command output and the `--json` JSONL protocol; logs go to stderr, or only to `CTG_LOG_FILE` when that is set. Use `CTG_LOG_FILE` when debugging the interactive console so log lines do not draw over the terminal UI.
- Fields are redacted before they are written or remembered. Keys whose name contains `authorization`, `token`, `apikey`/`api_key`, `password`, `secret`, `cookie`, `refresh`, `access`, `credential` or `privatekey` become `[REDACTED]`. In strings, `Bearer …`/`Basic …` credentials, `sk-…` keys, GitHub tokens, JWTs, credentials in URLs and `token=`/`key=`/`code=`/`signature=` query parameters are replaced. Errors are reduced to `name`, `message`, `code`, `status` and `cause`.
- Never pass prompt text, model output, file contents or request bodies as fields. Redaction is a safety net, not a license.
- A failing sink (closed stderr, unwritable log file) is ignored; logging never throws into the caller.

Pretty lines look like `2026-11-20T03:35:24.950Z WARN  [update] Check failed status=503`. JSON lines contain `time`, `level`, the bound context (`component`, …), `msg` and the fields.

Where the CLI and server log today:

| Component | Events |
| --- | --- |
| `server` | `/api/*` requests at `debug` (method, path, status, duration; never query strings), status and check-run failures at `error`, startup failure at `error`, a failed update check at `warn` |
| `update` | Control-plane release check unavailable (falling back to GitHub), passive update check failure, both at `debug` |
| `runtime`, `runtime-transport` | Runtime download start, invalid cached runtime, acquisition failure, GitHub API request failure (error name and code only), at `debug` |
| `http` | Each retry (host, attempt, status or error code, delay) at `debug`; circuit breaker opening at `warn`, other transitions at `debug` |
| `doctor` | Each failed check and an unreadable crash directory, at `debug` |

The dashboard's two startup lines (`carthagent dashboard: …` and `workspace: …`) are user-facing output on stdout, not log lines; tests and scripts read the URL from them.

## Crash reports

`bin/ctg.mjs` calls `installCrashHandlers()` from `lib/crash-report.mjs`. It listens to `uncaughtExceptionMonitor`, which sees both uncaught exceptions and unhandled promise rejections (Node raises those as uncaught exceptions by default) without replacing Node's handling. The error text Node prints and the exit code (1) are unchanged. The only visible difference is one extra stderr line:

```text
Crash report saved: /home/me/.carthagent/agent/logs/crash-2026-11-20T03-44-25-467Z-1d69ae6ebdd6-5809.json — run `ctg doctor` for details
```

Errors that `ctg` catches and reports as ordinary failures (a bad flag, a network error shown as a message) are not crashes and produce no report.

Location and retention:

- Directory: `<agent dir>/logs/`, where the agent directory is `CARTHAGENT_CODING_AGENT_DIR`, else `PI_CODING_AGENT_DIR`, else `~/.carthagent/agent` (the same resolution as `shipAgentDir()` in `lib/ship-auth.mjs`). The directory is created with mode `0700`, each report with mode `0600`.
- The newest 20 reports are kept; older ones are deleted when a new one is written. At most three reports are written per process.
- `CTG_CRASH_REPORTS=0` (or `false`, `off`, `no`) turns crash reports off.
- Writing a report never throws and never delays exit. If the directory is not writable, no report and no pointer line are produced.

Report format (schema 1):

| Field | Contents |
| --- | --- |
| `schema` | `1` |
| `timestamp` | ISO 8601 time of the crash |
| `fingerprint` | 12 hex characters: SHA-256 of the error name and the top five stack frames, with line numbers, query strings and machine-specific path prefixes removed (paths are reduced to their package-relative form). The same bug gives the same fingerprint across machines and minor edits |
| `origin` | `uncaughtException` or `unhandledRejection` |
| `ctg` | `version` and `installMethod` (`clone` when the package root has `.git`, else `npm`) |
| `runtime` | Node version, platform, architecture and OS release |
| `command` | `name` (the subcommand, `tui` for a bare `ctg`, `<task>` when the first argument is task text, `null` when it is a flag) and `flags`: flag names only. Flag values, task text and everything after `--` are dropped; unusual flag names become `<flag>` |
| `error` | `name`, `message`, `code` and `stack`, redacted like log fields, with the home directory replaced by `~` |
| `breadcrumbs` | The last 50 logger events (any level, including `debug` events that were not printed), already redacted, home directory replaced by `~` |

Reports never contain environment variables, prompt text, file contents, credentials or flag values.

## From a crash to an issue

1. The user sees the pointer line, or runs `ctg doctor` later.
2. `ctg doctor` adds a `! Last crash` warning row for the newest report from the last 14 days: time, fingerprint, error name and first line of the message. The row does not change doctor's exit code. Its fix line points to `ctg doctor --crash-report` (prints the full report as JSON on stdout and its path on stderr) and to a prefilled issue URL.
3. The URL opens `https://github.com/B-icy/Carthagent/issues/new?template=crash_report.yml` with the form fields `fingerprint`, `version` (ctg version, Node, platform and install method), `command` (for example `ctg update --check`) and `report` (error, top stack frames, origin and the last five breadcrumbs, truncated so the whole URL stays under about 1,800 characters). The user reviews the text and submits.
4. The form applies the labels `bug`, `source: crash-report` and `status: triage`. During triage, search open issues for the fingerprint first: issues with the same fingerprint are the same crash, so close duplicates in favor of the oldest and ask for the full report (`ctg doctor --crash-report`) if the excerpt is not enough.

## Retries and circuit breaker

`lib/http-resilience.mjs` provides `fetchWithRetry(url, init, options)`, `retryAsync(operation, options)` and `CircuitBreaker`.

Retry policy:

- Only idempotent methods (`GET`, `HEAD`) are retried. Any other method gets exactly one attempt.
- Retried: network errors (fetch's `TypeError: fetch failed`/`terminated` and socket or DNS codes such as `ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, `UND_ERR_SOCKET`) and HTTP 408, 429, 500, 502, 503, 504. Other statuses, aborts and timeouts requested by the caller are returned or thrown at once.
- Up to 3 attempts. The delay before attempt *n + 1* is uniformly random in `[0, min(4 s, 250 ms × 2^(n−1)))` (full jitter).
- `Retry-After` (seconds or an HTTP date) replaces the computed delay. A `Retry-After` longer than 10 s ends the retries and returns that response, rather than stalling the command.
- The caller's `AbortSignal` stops the loop, including during a wait. An optional `deadlineMs` skips any retry whose wait would not fit in the remaining time.
- When retries run out, the last response is returned (or the last error thrown) unchanged, so each caller keeps its own error messages.

Circuit breaker (one per host, per process): after 5 consecutive failures (network errors or retryable statuses) within 60 s the breaker opens and requests to that host fail at once with `CircuitOpenError` (`Network requests to <host> are paused after repeated failures; retrying in <n>s`). After a 30 s cooldown it lets one probe through (half-open); success closes it and failure opens it again. Any non-retryable response, including 4xx, counts as success because the host answered.

Where it applies:

| Call site | Behavior |
| --- | --- |
| `lib/update.mjs` `fetchLatestRelease()`: control plane `GET /v1/cli/releases/latest` | Retried, except 503, which means "not configured" and falls back to GitHub immediately. The existing 8 s timeout is now an overall bound for all attempts |
| `lib/update.mjs`: GitHub `releases/latest` and paginated `releases` | Retried within the same 8 s bound |
| `lib/opencode/runtime-github-transport.mjs`: authenticated release and asset metadata GETs (`CTG_RUNTIME_GITHUB_TOKEN`) | Retried. The asset download GET is not retried here; a transient failure is marked so the downloader restarts the whole transfer |
| `lib/opencode/runtime-artifact.mjs` `downloadArchive()` | `retryAsync` restarts the whole download, from an empty file, after a transient network error, a truncated body or a retryable status. The existing 120 s timeout stays an overall bound. No circuit breaker |

Not retried, by design: Cloud `POST`s, billing, sign-in and device-authorization polling, token refresh and rotation (`lib/opencode/credentials.mjs` has its own receipt-based logic), gateway and model invocations, and anything that is not a plain `GET`/`HEAD`.

To add resilience to another call, use `fetchWithRetry` only when repeating the request has no side effects, keep the caller's timeout as the signal and `deadlineMs`, and keep the caller's existing error handling for the final response.
