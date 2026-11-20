# Interactive QA for agents

This is the credential-free procedure for exercising Carthagent's three user
surfaces from an agent session: the local web dashboard, the headless `ctg` CLI,
and the native terminal UI. Nothing here needs a model provider, Carthagent
Cloud account, API key or paid call. Live-provider testing is a separate,
explicitly budgeted procedure in [native-manual-testing.md](native-manual-testing.md#5-explicit-live-provider-testing).

Verified on 2026-11-20 on linux-arm64 with Node 24.22.1 at release manifest
1.1.2 (`lib/opencode/runtime-release.json`).

## One-command smoke

```sh
node tools/qa-smoke.mjs --json artifacts/qa-smoke/report.json
node tools/qa-smoke.mjs --kit /tmp/ctg-manual-kit --json artifacts/qa-smoke/report.json
```

`tools/qa-smoke.mjs` creates a disposable workspace and an isolated `HOME`,
strips provider keys and GitHub tokens from the child environment, and then:

1. Starts `server.mjs` on an ephemeral port with a generated session token and
   checks `GET /api/status`, token rejection (401), foreign-Origin rejection
   (403), `POST /api/plan/validate` with a valid and an invalid plan,
   `POST /api/plan/set` followed by `GET /api/status`, `GET /api/docs/readme`
   and the HTML shell's content security policy.
2. Runs `ctg --help`, `ctg demo`, `ctg status --json`, `ctg hash`, and
   `ctg validate` with a valid plan (exit 0) and an invalid plan (exit 1).
3. With `--kit <dir>`, runs the native TUI offline smoke against a prepared
   manual kit (see below).

Each check prints `PASS` or `FAIL` with its evidence; the process exits 1 if any
check fails. `--json` writes the results for retention. Use `--skip-dashboard`
or `--skip-cli` to narrow the run. Typical output:

```text
PASS dashboard GET /api/status returns the idle workspace state (361 ms): status=idle planning.phase=discovery
PASS dashboard POST /api/plan/set persists a plan that /api/status reports (130 ms): report .../report.json; status=implementing; pending=smoke
PASS cli ctg demo runs the scripted offline demo (996 ms): exit 0, fixture tests passed
PASS native TUI offline smoke (scripted provider) via tools/native-manual.mjs (37031 ms): outcome=succeeded providerRequests=3 binary=2b20ad97fc13
15/15 QA smoke checks passed
```

## 1. Web dashboard

Start the dashboard against a scratch workspace. Port `0` picks a free port; a
fixed token makes the API scriptable (without it a random token is printed once).

```sh
mkdir -p /tmp/ctg-qa-ws && echo 'console.log("ok")' > /tmp/ctg-qa-ws/app.mjs
CARTHAGENT_NO_UPDATE_CHECK=1 CARTHAGENT_PORT=0 CARTHAGENT_SERVER_TOKEN=qa-token \
  CARTHAGENT_WORKSPACE=/tmp/ctg-qa-ws npm start
# prints: carthagent dashboard: http://127.0.0.1:<port>/?token=qa-token
```

Drive the API with the `x-carthagent-token` header. The full contract is in
[api/dashboard.md](api/dashboard.md) (generated from
[api/dashboard.openapi.json](api/dashboard.openapi.json)).

```sh
BASE=http://127.0.0.1:<port>
curl -s -H 'x-carthagent-token: qa-token' "$BASE/api/status"
curl -s -H 'x-carthagent-token: qa-token' -H 'content-type: application/json' \
  -d '{"plan":{"goal":"QA","artifacts":["."],"steps":["Run"],"acceptance":[{"requirement":"Runs","checks":["smoke"]}],"checks":[{"id":"smoke","kind":"runtime","argv":["node","app.mjs"],"timeoutSeconds":10}]}}' \
  "$BASE/api/plan/validate"
```

`POST /api/checks/run` requires the design gate (`/api/design` validate,
inspect, review, approve) to unlock implementation first; without it the
endpoint answers 500 with the gate message. `tests/server.test.mjs` shows the
complete approved flow.

For a rendered check and screenshot, use the bundled headless browser (it is
downloaded once into `~/.carthagent/browser/`):

```sh
node tools/webdriver-check.mjs --url "http://127.0.0.1:<port>/?token=qa-token" \
  --assert-text 'body:Carthagent' --wait-ms 1500 --screenshot artifacts/qa/dashboard.png
```

Stop the server with Ctrl+C (or `kill <pid>`). Delivery reports are written under
the workspace's `.harness/` directory; delete the scratch workspace afterwards.

## 2. CLI, headless

Run from a scratch directory with an isolated `HOME` so no real profile,
session or credential is read or changed:

```sh
mkdir -p /tmp/ctg-qa-home /tmp/ctg-qa-ws && cd /tmp/ctg-qa-ws
export HOME=/tmp/ctg-qa-home CARTHAGENT_NO_UPDATE_CHECK=1
node <repo>/bin/ctg.mjs --help          # exit 0, usage
node <repo>/bin/ctg.mjs demo            # exit 0, scripted fixture; no provider calls, no edits to the cwd
node <repo>/bin/ctg.mjs status --json   # exit 0, workspace fingerprint and report state
node <repo>/bin/ctg.mjs hash            # exit 0, 64-hex fingerprint
node <repo>/bin/ctg.mjs validate plan.json   # exit 0 when valid, 1 with the first error when invalid
```

`ctg doctor` is **not read-only**: it downloads the pinned native runtime
(about 74 MB on linux-arm64) into `$HOME/.carthagent/opencode/runtimes/`, starts
the profile's background service, and exits 1 when no provider is connected
(expected in credential-free QA). Run it only with an isolated `HOME`, then stop
the service with `node <repo>/bin/ctg.mjs service stop` and delete that `HOME`.

`ctg demo` output is fixture evidence only; it does not prove project delivery.

## 3. Native terminal UI

### Prepare a kit

```sh
npm run manual:prepare -- /tmp/ctg-manual-kit
```

This downloads the current platform's runtime archive from the GitHub release
named by `releaseVersion` in `lib/opencode/runtime-release.json`, verifies the
archive and executable digests, and creates disposable fixture projects. The
kit is about 190 MB. On 2026-11-20 the v1.1.2 release had all five assets
(`opencode-{linux-x64,linux-arm64,darwin-x64,darwin-arm64,windows-x64}.tar.gz`,
63 to 77 MB each); an HTTP 404 here means the checkout's manifest names a
release that is not published, so check out a commit whose `releaseVersion` is
published. No GitHub authentication is needed for published assets.

### Scripted offline smoke

```sh
node tools/native-manual.mjs /tmp/ctg-manual-kit tiny --smoke
```

Runs the real native binary and plugin with a scripted offline provider and
prints a JSON summary; expect `"outcome": "succeeded"` and `"completed": true`.

### Interactive session in tmux

Agents drive the TUI through tmux (or the `tuistory` skill), sending keys and
capturing the screen as text:

```sh
tmux new-session -d -s ctgqa -x 160 -y 45 \
  "cd <repo> && CARTHAGENT_NO_UPDATE_CHECK=1 node tools/native-manual.mjs /tmp/ctg-manual-kit tiny"
sleep 20                                   # first start initializes the kit profile
tmux capture-pane -p -t ctgqa > artifacts/qa/tui-start.txt
tmux send-keys -t ctgqa '/help' Enter      # opens the slash-command palette
sleep 3
tmux capture-pane -p -t ctgqa > artifacts/qa/tui-help.txt
tmux send-keys -t ctgqa C-c; sleep 2; tmux send-keys -t ctgqa C-c   # exit
tmux kill-session -t ctgqa 2>/dev/null
```

Expected first screen: the Projects/Voyages sidebar with the `project/` folder and
a "Manual tiny fixture" session, and a "Getting started" panel asking to sign in
or connect a provider. Offline mode cannot answer prompts with a real model;
use it for navigation, palettes, layout and rendering checks. Use a terminal
size that matches the scenario under test, and record it with the capture.

## Authentication

- Dashboard: the `x-carthagent-token` header must equal `CARTHAGENT_SERVER_TOKEN`
  (or the random token in the startup URL); requests with a foreign `Origin` are
  rejected. No other credential exists.
- CLI and TUI offline paths need no credentials. Keep `HOME` isolated so
  existing profiles under `~/.carthagent/opencode/` are never read.
- Bring-your-own-key testing is only for `--live` mode, after an explicit
  spending budget is agreed. Export the key in the shell that runs the command
  and nowhere else: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`
  or `GEMINI_API_KEY` are forwarded into the kit's private `profiles/live`
  profile. Never write keys into fixtures, captures, reports or commits, and
  delete the kit afterwards. `tools/qa-smoke.mjs` removes these variables from
  its child processes.

## Evidence

- `tools/qa-smoke.mjs --json artifacts/qa-smoke/report.json` records each check,
  its duration and evidence string, plus the Node version and platform.
- Keep TUI `tmux capture-pane` text and dashboard screenshots under
  `artifacts/qa/` (ignored by Git) and cite them by path in the handoff.
- Report the exact commands, exit codes, terminal size, kit `manual-kit.json`
  (runtime digest and source commit) and anything skipped. A capture is not
  visual approval unless someone inspected it.

## Cleanup

Stop servers and tmux sessions, run `ctg service stop` for any isolated `HOME`
that ran `doctor` or the TUI, and delete the scratch workspace, isolated `HOME`
and kit directories.
