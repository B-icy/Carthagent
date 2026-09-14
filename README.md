# pi2: Evidence-driven delivery

A package and CLI for [pi2](https://github.com/B-icy/pi-evidence-driven-delivery) and the [pi coding agent](https://github.com/earendil-works/pi-coding-agent) that turns software requests into evidence-backed deliveries: acceptance contracts with executable checks, source-freshness fingerprints that invalidate stale evidence, user-owned required validators, explicit task context, bounded repair nudges, and an opt-in scenario evaluation runner for smaller models. See `docs/workflow.svg` for the delivery flow and `docs/evaluation.md` for the honest live-trial history, failures included.

## CLI Usage

The package exposes the standalone `pi2` command line interface:

```sh
# Launch the interactive split-terminal console (persistent pi session)
pi2

# Preview the console without a provider — scripted demo run
pi2 demo

# Same, but immediately deliver a task — like `pi "..."`
pi2 "Build a Python task CLI with tests"

# Headless delivery run (also auto-selected when stdout is not a TTY)
pi2 -p "Build the requested software"

# Calculate workspace SHA-256 source freshness fingerprint
pi2 hash

# Run all declared verification checks
pi2 check all

# Inspect current plan, fingerprint, and pending status
pi2 status

# Launch the interactive web dashboard & workflow visualizer
pi2 serve

# Run test suite
pi2 test
```

### The interactive console

`pi2` (or `pi2 tui`) runs `pi --mode rpc` as a persistent agent session under a native terminal UI:

- **Messages:** streamed assistant text, thinking, tool calls, bounded output tails, shell commands, and steering while the agent runs.
- **Plan:** the active `plan.d2`, step state, declared checks, evidence freshness, usage, and workspace fingerprint.
- **Delivery framing:** plain implementation requests use the delivery template automatically. `/raw <text>` bypasses it once, `/guide` toggles it, and `--no-guide` disables it. Questions are sent verbatim.
- **Themes:** `opencode` (default), `tokyonight`, `nebula`, `ember`, `forest`, and `mono`; select one with `--theme`, `/theme`, or `^t`. The interface uses static surfaces and status indicators rather than decorative animations.

Keys: `enter` send (or steer mid-run) · `esc` abort/clear — press again while still running to force-restart a wedged pi process (the session file is resumed, nothing is lost) · `^r` session picker · `tab` focus feed/plan pane · `⇧tab` cycle split/feed/plan views · `↑↓` history or scroll focused pane · `pgup/pgdn`/wheel scroll focused pane · `x` expand tool output · `^t` settings overlay (theme/model/thinking) · `^n` new session · `^l` clear feed · `^c` quit (aborts a running agent first, then force-restarts).

Sessions persist under `~/.pi/agent/sessions/` like pi's own. `pi2 -c` continues the most recent session for the directory, `pi2 --session <path|id>` opens a specific one, and `pi2 -r` (or `pi2 resume`, `^r`, `/resume` inside the console) shows a filterable picker — the feed is rebuilt from the session file on switch.

Slash input is forwarded to pi (extension commands); built-ins: `/raw`, `/guide`, `/resume`, `/restart`, `/theme`, `/model`, `/thinking`, `/compact`, `/new`, `/export`, `/stats`, `/clear`, `/quit`.

Options: `--provider`, `--model`, `--thinking`, `--theme`, `--pi-cli`, `--session`, `-c/--continue`, `-r/--resume`, `--validators`, `--context`, `--bash-cap`, `--isolate` (run pi with only pi2's resources), `--no-strict`, `--no-delivery` (plain pi session), `--no-guide`, `--demo` (scripted mock run, no provider needed), `-p/--print` (headless).

The console is pure Node with zero dependencies — it runs anywhere pi runs: Linux, macOS, and Windows terminals (Windows Terminal, VS Code, or conhost with ANSI enabled). `pi2 demo` exercises the full visual pipeline against a scripted session.

`pi2 serve` opens a local dashboard for the workspace from which it is invoked. It binds to `127.0.0.1` and prints a per-launch authenticated URL. Treat that URL as sensitive because an authenticated dashboard can execute the checks declared by the active plan.

## Install

Install the package with the upstream `pi` CLI:

```sh
pi install git:github.com/B-icy/pi-evidence-driven-delivery
```

Or load the extension directly for one run:

```sh
pi -e /path/to/pi-evidence-driven-delivery/extensions/delivery.ts \
  --skill /path/to/pi-evidence-driven-delivery/skills \
  -p "Build the requested software"
```

After installation, `pi2` is the harness console and command-line interface; package management remains under `pi`. Requires Node 22.19 or newer and is tested with pi 0.85.1. No npm install is needed when loaded as a pi package because pi supplies the optional peer dependencies (`typebox`, `@earendil-works/pi-coding-agent`).

## Design

The failure pattern addressed here is **plausible code -> untested success claim**. A larger system prompt alone doesn't fix it. This package couples a compact workflow with executable, durable evidence:

1. Inspect real code, runtime versions and uncertain APIs.
2. Define a small acceptance contract and a runnable vertical slice.
3. Generate a D2 plan and implement incrementally.
4. Execute checks, collect actual exit status/logs, invalidate evidence after changes.
5. Review behavior and limitations; repair failures or report a blocker.
6. Only mark the contract verified when every required check has current evidence.

`lib/delivery.mjs` contains the testable mechanics; `extensions/delivery.ts` adapts them to pi lifecycle events. No pi internals, credentials, provider payloads, default model or trust policy are replaced.

## Request-aware delivery guidance

Before each agent run, pi2 quietly routes the request through the JSON profiles in `guidance/profiles/` — matched on request wording and, where a profile opts in, project dependencies. Matching profiles append focused planning, verification, and review requirements to the delivery system prompt before `delivery_plan` runs. A web project therefore receives the general web-application guidance automatically, while a request that also touches authentication, transactional data, external APIs, or charts picks up the additional relevant profiles. Profiles selected earlier in a run stay active through follow-up prompts and session resumes.

Routing is internal: it does not change the CLI, the plan contract, generated D2, or any interface. The only observable effect is that plans, checks, and reviews account for the risk classes the request actually involves.

Profiles are data rather than router branches. Add a future domain by creating another JSON file:

```json
{
  "id": "background-jobs",
  "title": "Background jobs",
  "priority": 50,
  "match": {
    "keywords": ["queue", "worker", "background job"],
    "dependencies": ["bullmq"]
  },
  "planning": ["Define delivery, retry, ordering, and idempotency semantics."],
  "checks": ["Test duplicate delivery, retry exhaustion, and worker restart."],
  "review": ["Reject unbounded retries and non-idempotent handlers."]
}
```

Set `"activateOnDependency": true` only when every change in projects using that dependency should receive the profile. Otherwise request keywords control activation. Invalid profiles fail during extension startup rather than silently weakening guidance.

## Tools

| Tool | Purpose |
|---|---|
| `delivery_plan` | Goal, assumptions, artifact roots, steps, acceptance/check mappings; writes `plan.d2` |
| `delivery_status` | Current contract, evidence and missing/failed/stale check IDs |
| `delivery_check` | Execute a declared ID, or **`id="all"`** for all suites sequentially |
| `delivery_finish` | Record reviewed `verified` or explicitly `blocked` handoff |

Use a few meaningful suites, not one command for every bullet. A criterion may reference the same suite as other criteria. Check commands use **argv arrays**, without an implicit shell. On Windows use a real `.exe`, `node script.mjs`, or an explicit shell for `.cmd`/shell syntax. All commands run in the project cwd.

Example plan shape:

```json
{
  "goal": "A working task CLI",
  "assumptions": ["Python standard library is sufficient"],
  "artifacts": ["tasks.py", "tests", "README.md"],
  "steps": ["Runnable add/list slice", "Persistence and errors", "Tests and handoff"],
  "acceptance": [{"requirement": "Commands work in fresh processes", "checks": ["tests"]}],
  "checks": [{"id": "tests", "kind": "test", "argv": ["python", "-m", "unittest", "discover", "-s", "tests"], "timeoutSeconds": 60}]
}
```

Artifact roots are files/directories, not globs. `["."]` is usually simplest. Generated-only roots such as `artifacts/` are rejected. Fingerprinting covers the **entire cwd**, not merely declared artifacts, so an undeclared new source/config file still invalidates previous results. Replanning resets evidence but cannot silently drop original acceptance text while work is active.

Excluded directory names: `.git`, `.venv`, `venv`, `node_modules`, `__pycache__`, `.harness`, `artifacts`, `saves`, `.tools`, `.pytest_cache`, `.ruff_cache`, `dist`, `build`, `.next`, `.nuxt`, `.cache`, `coverage`, `.turbo`, and `target`; compiled binary/object formats are also excluded. Do not put product source in excluded directories. Fingerprinting is deliberately bounded to 5,000 files / 64 MiB; it fails explicitly rather than silently omitting large inputs. Use an appropriately scoped cwd for larger repositories.

## User-owned required validators

Model-written tests can repeat the model's mistakes. Supply known tests or external probes independently of the model's proposed contract:

```json
{
  "version": 1,
  "checks": [
    {"id": "acceptance", "kind": "test", "argv": ["python", "/absolute/path/to/acceptance_tests.py"], "timeoutSeconds": 90}
  ]
}
```

Put that in **`.pi/delivery.json`** in a trusted project, or pass an explicit manifest:

```sh
pi -e /path/to/repo/extensions/delivery.ts \
  --skill /path/to/repo/skills \
  --delivery-strict --delivery-validators /path/to/validators.json \
  -p "Build the requested software"
```

Required check IDs must be at most 31 characters; they receive a `required_` ID prefix and are injected into every plan. The model cannot replace them by proposing the same ID or omit them from `delivery_finish`. Invalid manifests fail closed. The extension snapshots configuration on session startup/reload; restart/reload after changing it. Project configuration is read only when pi trusts the project; explicit CLI paths are deliberate opt-in.

These are workflow protections against mistakes, **not tamper-proof security**. A model with shell access can still edit test scripts or escape its work directory. For untrusted code use a disposable OS/container sandbox with restricted secrets/network; this package does not provide one. Test quality remains your responsibility.

## Explicit task context

The core delivery extension is task-agnostic. If a benchmark or project needs domain notes, pass them explicitly instead of hard-coding prompt matching into the extension:

```sh
pi -e /path/to/repo/extensions/delivery.ts \
  --skill /path/to/repo/skills \
  --delivery-strict \
  --delivery-context /path/to/context.md \
  --delivery-validators /path/to/validators.json \
  -p "Build the requested software"
```

Use this for any domain: browser-app accessibility checks, service API contracts, data-migration invariants, GUI/game renderer probes, or organization-specific deployment constraints. Keep the user prompt natural; put evaluator-owned quality standards and API-specific lessons in the context and required validators.

## Recovery, state and budgets

- Delivery operations are FIFO-queued. Parallel sibling check calls no longer cause an error/retry storm.
- Checks have 1–300 second deadlines and cancellation/process-tree termination support. They fail on source changes during execution, nonzero exit, output overflow, or cancellation.
- **Bounded shell commands (`--delivery-bash-cap N`):** pi's bash/powershell tools have no default timeout, so a single un-timed runaway command (observed live: `find /` consumed a whole 600 s trial) can block a bounded run until the wall clock expires. With the cap enabled, the extension patches un-timed or oversized shell timeouts to N seconds through the documented `tool_call` input mutation; 0 disables. The evaluation runner passes 120 s and tells the model to set bounded timeouts and avoid filesystem-wide searches.
- **Protected starting files (`--delivery-protect-existing`):** built-in whole-file writes, direct shell redirection, common scripted replacements, and shell remove/move/truncate commands cannot replace top-level files present at session start; focused edits remain available. This preserves verified starter slices and user-owned entry points during bounded repair loops.
- **Bounded whole-file rewrites (`--delivery-rewrite-cap N`):** after N built-in `write` calls to one path, the extension requires focused `edit` calls. This limits context growth and accidental regressions during long repair loops; 0 disables.
- **Provider pacing (`--delivery-turn-delay-ms N`):** waits after tool results so high-context tool loops do not burst into provider input-token rate limits. The base delay scales once per 50,000 active context tokens, is capped at 30 seconds, and 0 disables it.
- **Bounded tool context (`--delivery-tool-output-cap N`):** retains the beginning and end of oversized text tool results and directs the model to rerun a narrower command. This limits repetitive source/log dumps without discarding the durable evidence file; 0 disables.
- Logs have unique per-attempt paths under `.harness/<session>/<run>/`. Captured output is capped at 8 MiB per command. Check evidence also persists a short output tail (1,200 characters), so failures stay readable after compaction and in follow-up nudges.
- Contracts/evidence live in active-branch session entries and JSON reports. Restore uses `getBranch()`, not unrelated branches. Context reinjection preserves the contract after compaction without replacing pi's summary or dropping user messages; it carries compact evidence (pass/fail, fingerprint, short tails) rather than full logs.
- Incomplete implementations can trigger **at most two automatic follow-ups per user prompt**. Aborts, provider errors, blocked handoffs and pending user messages are respected. Follow-ups name the pending checks and quote the failing checks' exit codes and output tails, so a compacted or smaller model repairs the recorded failure instead of repeating a success claim or rationalizing a probe result as an environment limitation. This is not an unlimited autonomous retry loop.
- Normal interactive pi retains its usual token/time behavior. The opt-in evaluation runner additionally bounds wall time, **productive model turns, output and provider-reported cost**. Provider/connection errors are counted separately (`providerErrors`, `productiveTurns`, `endedOnProviderError` in the summary) and do not consume the turn budget; the wall-clock deadline still bounds the run. Cost limits are checked after responses and can overshoot by an in-flight response; they are not a billing guarantee.
- A required check passing is not a semantic proof that its name matches its behavior. Development validators, final holdout checks and manual/visual review should be tracked separately when evaluating output quality.

## Skills and prompts

- `/guide <task>` — explicit phased end-to-end delivery prompt.
- `software-delivery` — vertical slices, real subprocess tests, data integrity, Windows/Unicode pitfalls, services/web/refactors.
- `game-development` — import-safe game architecture, performance, real input smoke, screenshots, API-specific lessons. Scenario runners may inject this skill and starter recipe explicitly for graphics tasks; the core extension does not special-case game prompts.
- `game-development/assets/ursina_starter.py` — a runnable, tested graphics/input slice to adapt, **not a finished game**. Its smoke asserts a nonblank framebuffer by sampling pixels (`assert_nonblank`): a saved PNG alone is not render evidence. The assertion is unit-tested to reject flat, black and missing images.
- `game-development/scripts/verify_ursina.py` — independent real-renderer/nonblank-framebuffer probe. It reports framebuffer dimensions and sampled color counts, so a blank render cannot be rationalized as a headless-environment limitation.

D2 source is always generated; D2 itself is optional for rendering. With D2 installed: `d2 path/to/plan.d2 artifacts/plan.svg`. This repository's workflow was rendered with D2 0.7.1. A local downloaded binary is under `.tools/` on this workstation, not required for package installation.

## Test without model calls

```sh
npm ci
npm run check
npm test
```

npm and `package-lock.json` are the canonical dependency workflow. Run from the repository root. The suite discovers both `dist/cli.js` and `dist/bundle/cli.js` in common global layouts; if pi is elsewhere, set `PI_CLI` to the absolute CLI path. Pure-library tests need only Node. Tests cover contract validation, stale evidence, path boundaries, generated-only scope rejection, command errors/timeouts, cancellation, parallel queuing, branching, compaction context, bounded repairs, required validators, CLI report access, and dashboard authentication.

The game grader tests additionally require the game runtime dependencies:

```sh
python3 -m pip install -r scenarios/game/requirements.txt
npm run test:python
```

## Live evaluation (opt-in, spends API credit)

```sh
node ./evaluate.mjs --allow-live --task cli --mode both
.venv/bin/python -m pip install -r scenarios/game/requirements.txt
xvfb-run -a node ./evaluate.mjs --allow-live --task game --mode both --timeout 600 --max-turns 100 --python .venv/bin/python
```

`--dry-run` prints the fully assembled command lines, seed copies, and resolved validator manifest for a scenario without calling a provider.

### Scenarios are pluggable

Task domains are **manifests**, not special cases in the runner. Each `scenarios/<name>/` directory holds a `scenario.json` (prompt, shared `setup` context, custom-mode `context` files, optional `skills` to inline, `seeds`, `developmentChecks`, `holdoutChecks`) plus its graders and fixtures. Check argv entries support `{python}` `{node}` `{root}` `{home}` `{cwd}` `{scenario}` placeholders. The game profile is one such path — `scenarios/game/` contains its Minecraft-style prompt, the Ursina context notes, the `grade_minecraft_clone.py` acceptance grader, `requirements.txt`, and the deliberately-defective `baseline/minecraft.py` preserved for reference. Add a new domain by dropping in another directory; `evaluate.mjs --task <name>` picks it up, and `--scenario` is an explicit alias.

Defaults: `inception/mercury-2.5`, the direct Inception Labs Mercury 2.5 model configured in pi, with a 100-productive-turn cap. Override `--provider`, `--model`, `--python`, `--pi-cli`, `--timeout`, `--max-turns`, `--max-cost`. Existing pi authentication is used; no keys are copied into the repo.

Each trial gets a new directory. The concise scenario request remains the only user prompt; executable paths and bounded-run rules are appended as evaluator-owned system context. Baseline disables project context, extensions and skills. Custom loads this package, any scenario context through `--delivery-context`, and fixed required validators outside the candidate workspace. Both are scored after the run with development checks and final holdout checks, preserving each check's tier/provenance in `summary.json`; `externalGrade` is the holdout verdict. **The custom condition receives validator feedback during development**; this measures oracle-assisted harness behavior, not an unassisted model benchmark.

Game trials are one scenario, not a core-harness special case. They begin from the deliberately-defective baseline `scenarios/game/baseline/minecraft.py` (a preserved original baseline result, not an upgraded game), require `--python` pointing at an interpreter with Ursina and Pillow installed, and use `scenarios/game/grade_minecraft_clone.py` as the scenario acceptance grader. Development runs include both headless and normal-window checks so renderer-only success cannot hide a broken public launch path; the holdout reruns the full grade independently after the model exits. The interactive Linux grade also requires a display plus `xdotool` and `scrot` (for example, run the evaluation under `xvfb-run`).

Evidence includes event JSONL, tool counts, model turns, reported cost/tokens, deadlines, external scores and generated products. Recovered connection errors are logged without falsely marking a completed run as failed. One/few stochastic trials are not statistically sufficient to claim a general win.
