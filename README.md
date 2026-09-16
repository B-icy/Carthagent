# pi2 — evidence-driven delivery

CLI and [pi](https://github.com/earendil-works/pi-coding-agent) package that turns "here's my code, trust me" into verified deliveries: the agent must declare an acceptance contract, run real checks, and re-prove them whenever source changes. `docs/workflow.svg` shows the flow; `docs/evaluation.md` has the honest trial history, failures included.

## Install

Requires Node ≥ 22.19 — nothing else. [pi](https://github.com/earendil-works/pi-coding-agent) is bundled inside the package, so one command installs everything:

```sh
npm i -g github:B-icy/pi2 && pi2
```

Or from a clone:

```sh
git clone https://github.com/B-icy/pi2 && cd pi2
npm ci && npm i -g .          # gives you `pi2`; or just run `node bin/pi2.mjs`
```

## Connect a provider

First run needs AI credentials. One store (`~/.pi2/agent/auth.json`) covers the console, headless runs, and the dashboard.

**Subscription** (Claude Pro/Max, ChatGPT Plus/Pro, GitHub Copilot, xAI, OpenRouter, Radius):

```sh
pi2 login          # opens pi's auth — run /login, pick a provider, /quit when done
```

You can also run `/login` (or `/auth`) from inside the console: it opens an in-console popup to pick a provider and auth method, then handles OAuth URLs, device codes, and API-key prompts inline — no terminal hand-off — and restarts the agent once connected.

**API key** — export the env var, or run `pi2 login` and pick a key provider to store it:

```sh
export ANTHROPIC_API_KEY=sk-ant-...   # or OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, XAI_API_KEY, ...
pi2
```

Multiple providers can be connected at once — credentials coexist in `~/.pi2/agent/auth.json`. In the console, `^t` (settings) has a **provider** row above **model**: `←→` switches providers (and selects that provider's first model), while the model picker stays scoped to the chosen provider. `/login` adds another provider at any time.

Full provider list: [pi providers docs](https://github.com/earendil-works/pi-coding-agent/blob/main/docs/providers.md). Override the default model with `--model <id>` (e.g. `pi2 --model sonnet`). Your last model choice (via `--model`, `/model`, or the `^t` settings picker) is saved to `~/.pi2/config.json` and reused on the next launch — pass a flag to override it for that run.

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

Inside the console: `enter` send/steer · `esc` abort (again = force-restart pi, nothing is lost) · `^r` session picker · `tab`/`⇧tab` panes · `x` expand tool output · `^v` paste · `^t` settings · `^c` quit. Sessions persist under `~/.pi2/agent/sessions/`; `pi2 -c` continues the last one, `-r` opens the picker.

**Themes:** 21 AA-contrast-verified options — dark (`opencode`, `tokyonight`, `nebula`, `ember`, `forest`, `mono`, `obsidian`, `midnight`, `nord`, `solarized-dark`, `okabe-dark`, `contrast-dark`), light (`paper`, `daylight`, `solarized-light`, `okabe-light`, `contrast-light`), and adaptive (`solarized`, `okabe`, `contrast`, `system`) that follow `COLORFGBG` or `PI2_THEME_MODE=light|dark`. Pick via `--theme`, `/theme`, or `^t`; the choice is saved to `~/.pi2/config.json` and reused on the next launch. The dashboard has the same set behind a header picker (persisted in `localStorage`). `okabe-*` uses the colorblind-safe Okabe-Ito palette.

Useful flags: `--model`, `--thinking`, `--validators <file>`, `--context <file>`, `--bash-cap <sec>`, `--review ask|yes|no`, `--isolate`, `--no-delivery`, `--no-guide`, `-c`/`-r`/`--session`.

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

## Self-review

When a run finishes a substantial change (a verified delivery or file edits), pi2 can offer a review loop: the agent pushes a branch, opens a PR, and a **detached fresh-context reviewer** (`pi2 review <pr>` — a separate engine process with no shared context) inspects it. Findings come back to the working agent, which fixes, pushes, and re-reviews — up to 3 rounds (enforced by the delivery extension) or `VERDICT: APPROVE`.

It's opt-in and tri-state, resolved as `--review <mode>` flag → `~/.pi2/config.json` → `ask`:

| Mode | Behavior |
|---|---|
| `ask` (default) | Offer the loop at the end of a major change (`^y` accepts, `esc` skips) |
| `yes` | Start the loop automatically — no prompt |
| `no` | Never offer |

```sh
pi2 review            # show the effective default
pi2 review yes        # persist a default for all sessions
pi2 review 14         # run the fresh-context reviewer over a PR directly
pi2 --review no       # per-launch override
```

Inside a session, `/review` starts a loop immediately and `/review ask|yes|no|status` manages the same default. The loop needs `git` + an authenticated `gh` — without them the agent reports and skips instead of simulating a review.

## Make it yours

Everything below is config, not code:

- **Required validators** — your tests, not the model's. `.pi2/delivery.json` (trusted project) or `--validators file.json`: `{"version":1,"checks":[{"id":"acceptance","kind":"test","argv":["pytest","-q"],"timeoutSeconds":90}]}`. They can't be omitted or overridden.
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
