# Carthagent

> **Evidence-driven software delivery, from plan to proof.**

Carthagent is a delivery-focused AI coding console and CLI built on a bundled delivery engine. It turns “here’s my code, trust me” into an auditable delivery: the agent declares an acceptance contract, runs real checks, and re-proves them whenever source changes.

`docs/workflow.svg` shows the flow; `docs/evaluation.md` has the honest trial history, failures included.

## Install

Core CLI requires Node ≥ 22.19. Optional workflows need additional tools: Git and authenticated `gh` for PR review, Firefox/geckodriver for real-browser checks, and Python with the scenario dependencies for game graders. The engine is bundled inside the package, so one command installs everything:

```sh
npm i -g github:B-icy/Carthagent && ctg
```

Or from a clone:

```sh
git clone https://github.com/B-icy/Carthagent && cd Carthagent
npm ci && npm i -g .          # gives you `ctg`; or just run `node bin/ctg.mjs`
```

## Connect a provider

First run needs AI credentials. One store (`~/.carthagent/agent/auth.json`) covers the console, headless runs, and the dashboard.

Run `ctg login`, or use `/login` (`/auth`) inside the console. All three entry points open the same provider picker. Carthagent Ship, powered by the Experiential gateway, appears first as the recommended managed option, while Anthropic, OpenAI, OpenRouter, and the other direct providers remain immediately selectable. Connected providers are marked without changing the stable ordering.

The popup handles OAuth URLs, device codes, and API-key prompts inline. An in-session login returns to the active workspace and refreshes the agent without discarding the transcript or editor state.

**Carthagent Ship / Experiential Labs** — choosing the recommended Ship row starts browser device authorization. Carthagent stores only the resulting short-lived access token and rotating refresh token in its isolated credential store; it does not ask users to paste a long-lived managed gateway key. After signing in:

```sh
ctg account                    # credit, grants, plan, and CLI sessions
ctg billing checkout           # Builder subscription checkout URL
ctg billing portal             # Stripe customer portal URL
ctg logout-cloud [session-id]  # revoke the current or a named CLI session
```

Inside the console, `/account`, `/billing checkout`, `/billing portal`, and `/logout-cloud <session-id>` provide the same account controls without leaving the workspace. If Ship credit is exhausted, the console offers billing and `/login`; direct Anthropic, OpenAI, OpenRouter, custom, and other BYOK providers remain available without an upsell.

Operators and internal pilots may still provide `EXPLABS_API_KEY` through the environment for direct Experiential access; that key path remains separate from the public device flow. `CARTHAGENT_CLOUD_URL` may override the Carthagent account/control-plane origin, while `EXP_GATEWAY_URL` specifically overrides the direct Experiential model gateway origin for preview or staging. Browser-account requests use the Cloud authority at the control-plane origin; API-key requests continue to use Experiential directly. Carthagent discovers model identities from `GET /v1/models`; the endpoint does not provide capability or pricing metadata, so Carthagent does not infer those fields.

The embeddable Cloud service also includes a hosted request authority for `GET /v1/models`, `POST /v1/chat/completions`, and `POST /v1/responses`. Operators publish immutable customer-pricing versions and versioned Carthagent aliases in the control plane. Every request receives a bounded output limit and atomically reserves its maximum customer charge before Experiential dispatch. Settlement requires authoritative gateway request and physical-attempt identities plus measured token usage; known pre-dispatch failures release the hold, while ambiguous transport or accounting outcomes retain it for reconciliation instead of guessing a charge.

**Direct provider API key** — export the provider's env var, or choose it in the shared login picker to store it:

```sh
export ANTHROPIC_API_KEY=sk-ant-...   # or OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, XAI_API_KEY, ...
ctg
```

Multiple providers can be connected at once — credentials coexist in `~/.carthagent/agent/auth.json`. In the console, `^t` (settings) has a **provider** row above **model**: `←→` switches providers (and selects that provider's first model), while the model picker stays scoped to the chosen provider. `/login` adds another provider at any time.

Full provider list: [provider docs](https://github.com/earendil-works/pi-coding-agent/blob/main/docs/providers.md). Override the default model with `--model <id>` (e.g. `ctg --model sonnet`). Your last model choice (via `--model`, `/model`, or the `^t` settings picker) is saved to `~/.carthagent/config.json` and reused on the next launch — pass a flag to override it for that run.

## Use it

```sh
ctg                           # interactive console (persistent engine session)
ctg "Build a task CLI"        # console, with a task
ctg -p "..."                  # headless run (auto when stdout isn't a TTY)
ctg demo                      # scripted mock run — no provider needed
ctg status                    # fingerprint, contract, pending checks
ctg check all                 # run declared checks
ctg account                   # Ship balance, plan, grants, and sessions
ctg billing checkout          # Ship Builder checkout URL
ctg serve                     # web dashboard (127.0.0.1, authenticated URL)
ctg test                      # unit suite
ctg --help                    # everything else
```

Inside the console: `enter` send/steer · `esc` abort (again = force-restart the engine, nothing is lost) · `^r` session picker · `tab`/`⇧tab` panes · `x` expand tool output · `^v` paste · `^t` settings · `^c` quit. Sessions persist under `~/.carthagent/agent/sessions/`; `ctg -c` continues the last one, `-r` opens the picker.

**Themes:** 22 AA-contrast-verified options — the default purple-and-gold `carthage` palette; dark (`opencode`, `tokyonight`, `nebula`, `ember`, `forest`, `mono`, `obsidian`, `midnight`, `nord`, `solarized-dark`, `okabe-dark`, `contrast-dark`); light (`paper`, `daylight`, `solarized-light`, `okabe-light`, `contrast-light`); and adaptive (`solarized`, `okabe`, `contrast`, `system`) themes that follow `COLORFGBG` or `CARTHAGENT_THEME_MODE=light|dark`. Pick via `--theme`, `/theme`, or `^t`; moving through the picker previews each colorway before Enter commits it. The choice is saved to `~/.carthagent/config.json` and reused on the next launch. The dashboard picker also previews themes on hover and persists the selected theme in `localStorage`. `okabe-*` uses the colorblind-safe Okabe-Ito palette.

Useful flags: `--model`, `--thinking`, `--validators <file>`, `--context <file>`, `--bash-cap <sec>`, `--review ask|yes|no`, `--isolate`, `--no-delivery`, `--no-guide`, `--ascii`, `--glyphs <mode>`, `-c`/`-r`/`--session`.

**Glyphs:** icons, status dots, spinners and the D2 graph adapt to your terminal. `--glyphs auto` (default) keeps the Unicode set on terminals known to render it and falls back to an ASCII icon tier everywhere else, so tool icons, status marks and spinners never show up as `?` on limited fonts. Force one with `--ascii`, `--glyphs unicode|ascii`, or `CARTHAGENT_GLYPHS=unicode|ascii` / `CARTHAGENT_ASCII=1`.

## How it works

`extensions/delivery.ts` wires five tools into the engine (`lib/delivery.mjs` has the mechanics):

| Tool | What it does |
|---|---|
| `delivery_plan` | Goal, steps, artifact roots, acceptance criteria → check mapping; `verification: required|advisory|none`; writes `plan.d2` |
| `delivery_check` | Runs a check argv with a deadline; records exit code, logs, workspace SHA-256 |
| `delivery_status` | Contract + evidence state (missing/failed/stale) |
| `delivery_progress` | Step progress for the plan panel |
| `delivery_finish` | `verified` only if every required check has fresh evidence; otherwise `blocked` |

The discipline: evidence is bound to the run, contract revision, executable check definition and workspace source fingerprint. Source edits invalidate evidence; dependency, cache and generated-output exclusions mean this is not a hash of every file. `verified` means declared required checks passed with current evidence—not independent proof of task completeness or correctness. Checks are real subprocesses (`argv`, no implicit shell), FIFO-queued, 1–300 s deadlines, logs under `.harness/`. Failed or missing checks get at most two automatic repair nudges per prompt. This is a workflow guardrail, not a security sandbox — for untrusted code use a container.

**Informational vs delivery asks.** Every plan declares a verification classification. `required` (the default) is the delivery contract above. `advisory` is for an informational answer that still benefits from running checks: the checks execute and their real exit codes are recorded, but a failure is reported as context instead of forcing a repair loop. `none` is a pure question/explanation with no checks at all. Informational plans finish with `delivery_finish` once (recorded as `advisory: true`) and never receive repair nudges; user-owned required validators always force `required`, and a `required` plan can only be reclassified before any check has run.

## Self-review

When a run finishes a substantial change (a verified delivery or file edits), Carthagent can offer a review loop: the agent pushes a branch, opens a PR, and a **detached fresh-context reviewer** (`ctg review <pr>` — a separate engine process with no shared context) inspects it. Findings come back to the working agent, which fixes, pushes, and re-reviews — stopping after 3 admitted attempts per PR in this workspace or `VERDICT: APPROVE`. The CLI persists round admission and structured snapshot-bound findings, excludes concurrent reviewers, and escalates exhausted attempts. Review commands reject malformed verdicts and changed source/PR-head snapshots, but read-only behavior is an instruction, not isolation. See [review guarantees and limits](docs/review-assurance.md).

It's opt-in and tri-state, resolved as `--review <mode>` flag → `~/.carthagent/config.json` → `ask`:

| Mode | Behavior |
|---|---|
| `ask` (default) | Offer the loop at the end of a major change (`^y` accepts, `esc` skips) |
| `yes` | Start the loop automatically — no prompt |
| `no` | Never offer |

```sh
ctg review                   # show the effective default
ctg review yes               # persist a default for all sessions
ctg review 14                # run the fresh-context reviewer over a PR directly
ctg --review no              # per-launch override
```

Inside a session, `/review` starts a loop immediately and `/review ask|yes|no|status` manages the same default. The loop needs `git` + an authenticated `gh` — without them the agent reports and skips instead of simulating a review.

## Make it yours

Everything below is config, not code:

- **Required validators** — your tests, not the model's. `.carthagent/delivery.json` (trusted project) or `--validators file.json`: `{"version":1,"checks":[{"id":"acceptance","kind":"test","argv":["pytest","-q"],"timeoutSeconds":90}]}`. They can't be omitted or overridden.
- **Domain guidance** — add a JSON profile to `guidance/profiles/` (keywords/deps → planning/check/review requirements) and matching requests pick it up automatically.
- **Extra context** — `--delivery-context notes.md` injects project/benchmark-specific instructions.
- **Scenarios** — `scenarios/<name>/scenario.json` defines an evaluation domain; `node evaluate.mjs --task <name> --allow-live` runs it (dry-run with `--dry-run`; spends API credit otherwise).

See [extending Carthagent](docs/extending.md) for how to author guidance profiles, prompt templates, skills, providers, and extensions.

## Bounded runs and browser evidence

```sh
ctg -p --max-tools 100 --max-seconds 900 --max-repairs 2 "Implement the requested change"
```

Limits are opt-in, session-persistent cooperative controls—not dollar/token caps or hard process deadlines. Inspect with `/delivery-budget-status`; only an explicit `/delivery-budget-reset` starts a fresh allowance in the same session. See [session budgets](docs/budgets.md).

Browser evidence has two tiers: jsdom for DOM/unit checks (module scripts are rejected when execution is requested), and real Firefox/WebDriver for application modules and interactions. Firefox checks subscribe to browser errors before navigation and fail on unexpected console errors, exceptions and rejected promises. Screenshots are evidence to inspect, not automatic visual approval. See [browser setup and checks](docs/webdriver.md).

## Development

```sh
npm ci && npm run quality                  # lint, typecheck, build and tests; no model calls
npm run test:browser                       # real Firefox; requires Firefox/geckodriver
python3 -m pip install -r scenarios/game/requirements.txt && npm run test:python   # game graders
# Only with explicit spending authorization and a cap:
node evaluate.mjs --task cli --mode both --allow-live   # live A/B eval — spends API credit
```

Tests cover contract validation, stale evidence, required validators, timeouts/cancellation, compaction, actual-engine session budgets, report conflicts, and dashboard auth. Native CI covers Windows/macOS/Linux on Node 22/24; a separate Linux job runs real Firefox. WSL JS/browser evidence is local and separate; WSL Python validation remains unperformed successfully. This does not establish all terminals or browsers as supported/tested. `PI_CLI` points the suite at a non-standard engine location.

See [repository quality gates](docs/quality.md) and [controlled evaluation readiness](docs/evaluation-readiness.md). Review admission is persistently bounded locally; delivery operations now share a workspace lock and explicit active-run pointer with same-run live reconciliation. See [coordination and recovery](docs/workspace-coordination.md) for limits and interrupted-lock handling. No controlled paid comparison yet establishes lower cost or fewer interventions for complete web deliveries.
