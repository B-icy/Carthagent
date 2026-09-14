# pi2 — evidence-driven delivery

CLI and [pi](https://github.com/earendil-works/pi-coding-agent) package that turns "here's my code, trust me" into verified deliveries: the agent must declare an acceptance contract, run real checks, and re-prove them whenever source changes. `docs/workflow.svg` shows the flow; `docs/evaluation.md` has the honest trial history, failures included.

## Install

Requires Node ≥ 22.19 and [pi](https://github.com/earendil-works/pi-coding-agent) (tested with 0.85.1).

```sh
# install as a pi package
pi install git:github.com/B-icy/pi-evidence-driven-delivery

# or load it for a single run
pi -e /path/to/pi2/extensions/delivery.ts --skill /path/to/pi2/skills -p "Build the thing"
```

For development:

```sh
git clone https://github.com/B-icy/pi2 && cd pi2
npm ci
```

## Use it

```sh
pi2                    # interactive console (persistent pi session)
pi2 "Build a task CLI" # console, with a task
pi2 -p "..."           # headless run (auto when stdout isn't a TTY)
pi2 demo               # scripted mock run — no provider needed
pi2 status             # fingerprint, contract, pending checks
pi2 check all          # run declared checks
pi2 serve              # web dashboard (127.0.0.1, authenticated URL)
pi2 test               # unit suite
pi2 --help             # everything else
```

Inside the console: `enter` send/steer · `esc` abort (again = force-restart pi, nothing is lost) · `^r` session picker · `tab`/`⇧tab` panes · `x` expand tool output · `^t` settings · `^c` quit. Sessions persist under `~/.pi/agent/sessions/`; `pi2 -c` continues the last one, `-r` opens the picker.

**Themes:** 21 AA-contrast-verified options — dark (`opencode`, `tokyonight`, `nebula`, `ember`, `forest`, `mono`, `obsidian`, `midnight`, `nord`, `solarized-dark`, `okabe-dark`, `contrast-dark`), light (`paper`, `daylight`, `solarized-light`, `okabe-light`, `contrast-light`), and adaptive (`solarized`, `okabe`, `contrast`, `system`) that follow `COLORFGBG` or `PI2_THEME_MODE=light|dark`. Pick via `--theme`, `/theme`, or `^t`. The dashboard has the same set behind a header picker. `okabe-*` uses the colorblind-safe Okabe-Ito palette.

Useful flags: `--model`, `--thinking`, `--validators <file>`, `--context <file>`, `--bash-cap <sec>`, `--isolate`, `--no-delivery`, `--no-guide`, `-c`/`-r`/`--session`.

## How it works

`extensions/delivery.ts` wires five tools into pi (`lib/delivery.mjs` has the mechanics):

| Tool | What it does |
|---|---|
| `delivery_plan` | Goal, steps, artifact roots, acceptance criteria → check mapping; writes `plan.d2` |
| `delivery_check` | Runs a check argv with a deadline; records exit code, logs, workspace SHA-256 |
| `delivery_status` | Contract + evidence state (missing/failed/stale) |
| `delivery_progress` | Step progress for the plan panel |
| `delivery_finish` | `verified` only if every required check has fresh evidence; otherwise `blocked` |

The discipline: evidence is fingerprinted against the whole workspace — edit any file and its checks go stale. Checks are real subprocesses (`argv`, no implicit shell), FIFO-queued, 1–300 s deadlines, logs under `.harness/`. Failed or missing checks get at most two automatic repair nudges per prompt. This is a workflow guardrail, not a security sandbox — for untrusted code use a container.

## Make it yours

Everything below is config, not code:

- **Required validators** — your tests, not the model's. `.pi/delivery.json` (trusted project) or `--validators file.json`: `{"version":1,"checks":[{"id":"acceptance","kind":"test","argv":["pytest","-q"],"timeoutSeconds":90}]}`. They can't be omitted or overridden.
- **Domain guidance** — add a JSON profile to `guidance/profiles/` (keywords/deps → planning/check/review requirements) and matching requests pick it up automatically.
- **Extra context** — `--delivery-context notes.md` injects project/benchmark-specific instructions.
- **Scenarios** — `scenarios/<name>/scenario.json` defines an evaluation domain; `node evaluate.mjs --task <name> --allow-live` runs it (dry-run with `--dry-run`; spends API credit otherwise).

## Development

```sh
npm ci && npm run check && npm test          # unit + integration suite (no model calls)
python3 -m pip install -r scenarios/game/requirements.txt && npm run test:python   # game graders
node evaluate.mjs --task cli --mode both --allow-live   # live A/B eval — spends API credit
```

Tests cover contract validation, stale evidence, required validators, timeouts/cancellation, compaction, bounded repairs, and dashboard auth. `PI_CLI` points the suite at a non-standard pi location.
