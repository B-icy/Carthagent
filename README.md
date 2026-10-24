# Carthagent

> **Evidence-driven software delivery, from plan to proof.**

Carthagent is a delivery-focused AI coding console and CLI built on a bundled delivery engine. It turns “here’s my code, trust me” into an auditable delivery: the agent declares an acceptance contract, runs real checks, and re-proves them whenever source changes.

`docs/workflow.svg` shows the flow; `docs/evaluation.md` has the honest trial history, failures included.

## Native Carthagent preview

In experimental **1.1.0-preview.8**, native is the default `ctg` interface. Ship retains the legacy delivery workflow, including approval, checks, review, repair, recovery, and resume; Lite remains direct execution. Installing the experimental channel is still explicit. Stable 1.0.7 retains the legacy console.

```sh
ctg
ctg --help
ctg native  # compatibility alias
```

The old `CTG_NATIVE` toggle no longer changes routing. The native route launches the checksum-pinned CTG-owned runtime (compatibility 2.0.32) and uses a separate Carthagent-owned profile beneath `~/.carthagent/opencode/` (override with `CTG_OPENCODE_HOME`). Its config, database, sessions, auth, state, and cache are separate from other coding-tool profiles. It does not install, upgrade, or reuse credentials from other coding-tool profiles. Project files and native task metadata/worktrees are separate again: task records live in each project’s `.harness/opencode-tasks.json`.

Native projects use the native project/session model. CTG task creation associates a task with an independent native session and native worktree; task relations are CTG metadata, not parent/child native sessions. Native session resume/continue is scoped to the active workspace. Legacy Pi transcripts can be listed, searched, read, and exported with `ctg archive`; they are **read-only archives** and cannot be resumed or imported as native sessions. See the [native upgrade and migration guide](docs/native-upgrade.md) before switching workflows.

The native TUI exposes CTG workspace/task actions such as `/ctg-workspace`, `/ctg-open`, `/ctg-worktree`, and `/ctg-task`, alongside delivery and session commands. The native runtime owns the terminal renderer and lifecycle. Do not assume a listed command overrides a built-in host command: submitted `/help` precedence is a known unresolved acceptance gate.

```sh
node bin/ctg.mjs                         # native interactive TUI
node bin/ctg.mjs "Build a task CLI"      # task in the TUI
node bin/ctg.mjs resume                  # native session picker
node bin/ctg.mjs continue                # latest native session here
node bin/ctg.mjs -p "Summarize this repo" # headless text
node bin/ctg.mjs --json -p "Run checks" # native lifecycle JSONL
node bin/ctg.mjs status --json           # delivery status JSON
node bin/ctg.mjs archive list            # legacy archive (read-only)
```

The native CLI retains command aliases such as `ui`/`interactive`, `sessions`, `s`, `c`, `fingerprint`, `auth`, `cloud`, `web`, `start`, and `upgrade`. `--json` with a headless prompt emits JSONL records for native tool start/end, assistant message completion, and terminal outcome; it is not the text `-p` stream. Headless success requires the native completed assistant turn and successful terminal outcome. Options whose enforcement is not advertised by the active native plugin fail closed; in particular `--bash-cap` and `--isolate` are currently unsupported. Refer to [native CLI compatibility details](docs/native-cli.md).

Each experimental release must pass its exact installed-package gate before publication. Earlier migration findings and remaining platform caveats are recorded in: [Native migration ledger](docs/opencode-migration.md#delivery-ledger), [native compatibility matrix](docs/native-compatibility.md), and [terminal evidence status](docs/native-terminal-semantics.md#evidence-status-pr-162).

### Voyages in the native TUI

`/voyages` opens the account's live Voyages profile, coin wallet, equipment and
shop. Use the normal `/login` browser device approval and choose Carthagent;
Voyages uses the approving browser user's existing player, not a separate CLI
wallet. Older account-only Ship sessions may require a new device sign-in.
Voyages does not require a paid model call or award coins for coding.

Customization and equipment changes require confirmation. Paid items require a
server quote showing the coin price and expiry, followed by explicit purchase
confirmation. Cancel does not purchase. The server validates funds, ownership,
eligibility and profile version; refresh after a conflict rather than silently
overwriting another client. Equip a purchased item separately.

If a purchase response is lost, the TUI keeps a pending request across restart.
Use its recovery action to retry the same quote and request key, not to create
a second purchase. Do not delete profile state to resolve an uncertain debit.
The server remains authoritative; unavailable or signed-out state must not be
treated as a saved balance. Browser cookies are never imported into CLI auth.

This source feature is not a release claim. Published runtime availability and
live terminal/web acceptance remain gates of the next experimental candidate;
an older immutable release tag does not acquire changes from current main.

## Install and update

The package requires Node ≥ 22.19. A published stable release is installed from its exact release tag, not an unpinned branch:

```sh
npm install -g --install-links=true github:B-icy/Carthagent#vX.Y.Z
ctg
```

Replace `vX.Y.Z` with a published release tag. npm 11 requires the per-command `--install-links=true` flag for this GitHub global install. Native releases acquire and verify their own platform runtime from the exact tagged assets; they never fall back to an unrelated system binary. See the [native upgrade guide](docs/native-upgrade.md) for source-checkout and profile-preservation instructions, or [legacy CLI instructions](docs/legacy-cli.md) for stable 1.0.7.

`ctg update --check` checks for a published release without installing. Select `--channel experimental` to include published previews; drafts are never installed. The legacy stable updater can update a clean source clone. The native updater differs: it refuses to check out a release into any active source clone, including a clean one; it installs package releases only from an npm installation. Preserve local changes and use the manual exact-tag checkout procedure in the [native upgrade guide](docs/native-upgrade.md) when updating a development checkout. Do not treat this documentation change as a release: version selection, publishing, and tagging happen separately after product acceptance. See the [UNRELEASED draft notes](docs/release-notes-native-draft.md).

## Update channels

Starting with 1.0.7, update channels are an explicit opt-in:

```sh
ctg update --channel experimental --check  # preview; installs/persists nothing
ctg update --channel experimental          # install and remember the experimental channel
ctg update --channel beta                  # stable + beta/RC releases only
ctg update --channel stable                # leave previews; downgrade to stable if necessary
ctg update                                # follow the channel you last installed successfully
```

Stable is the default and never selects a prerelease, even if a remote manifest
mislabels it. Beta accepts published `-beta` and `-rc` tags; experimental also
accepts alpha, preview, and other published prerelease tags. Both opt-in channels
include stable releases. Selection uses semantic version order, not release date;
drafts are never installable. Prereleases are read directly from GitHub and never
advance the stable control-plane pointer.

A successful explicit switch is saved in `~/.carthagent/update-channel.json`;
`--check` and failed installs do not change it. `CARTHAGENT_UPDATE_CHANNEL_FILE`
can isolate this preference for testing. `--channel stable` explicitly authorizes
a downgrade, so recovery from an experimental build does not require `--force`.
Your sessions and provider credentials are not deleted by switching channels.
Experimental software may still contain bugs; read its release notes first.

## Regular CLI

The split-terminal console remains available in stable 1.0.7, not as an alternate route inside the native-default experimental package. To return to stable, use `ctg update --channel stable`. Its legacy data and provider setup remain distinct from the native profile; existing transcripts remain available through the read-only archive commands.

## Delivery engine and existing CLI

The following delivery-engine documentation describes Carthagent's shared delivery concepts and the existing CLI behavior. Native-preview coverage and compatibility are tracked separately in the [native CLI guide](docs/native-cli.md) and [migration ledger](docs/opencode-migration.md); feature parity must not be inferred from the presence of a shared delivery module.

## How it works

`extensions/delivery.ts` wires eight tools into the engine (`lib/delivery.mjs` has the mechanics):

| Tool | What it does |
|---|---|
| `delivery_plan` | Goal, steps, artifact roots, acceptance criteria → check mapping; `verification: required|advisory|none`; writes `plan.d2` |
| `delivery_design` | Validate SRP/DI contracts and scenarios, record adversarial review, approve the exact revision/snapshot before code |
| `delivery_revise` | Reason + partial plan patch; preserves valid evidence and stable progress, records revision history |
| `delivery_check` | Runs check argv with deadlines; `all` collects ordinary failures across suites; records exit codes, logs, workspace SHA-256 |
| `delivery_status` | Contract + evidence state (missing/failed/stale) |
| `delivery_progress` | Step progress for the plan panel |
| `delivery_review` | Captures the actual diff; records per-requirement assertions, boundary probes and limitations against the unchanged snapshot |
| `delivery_finish` | `verified` requires fresh checks, new-requirement executions, existing artifacts/output files, completed structured steps and a review receipt; otherwise `blocked` |

The discipline: evidence is bound to the run, contract revision, executable check definition and workspace source fingerprint. Source edits invalidate evidence; dependency, cache and generated-output exclusions mean this is not a hash of every file. `verified` means declared required checks passed with current evidence—not independent proof of task completeness or correctness. Checks are real subprocesses (`argv`, no implicit shell), FIFO-queued, 1–300 s deadlines, logs under `.harness/`. Failed or missing checks get at most two automatic repair nudges per prompt. This is a workflow guardrail, not a security sandbox — for untrusted code use a container.

`extensions/codegraph.ts` adds a `code_nav` tool: a deterministic tree-sitter index of the workspace (JS/TS/Python/Rust) with ops `definition`, `symbols`, `callers`, `callees`, `imports`, `importers`, `outline`, `status`. It parses lazily on first call and re-parses only files whose mtime changed; `--codegraph-max-files N` caps the scan (default 8000).

Structural navigation is available before plan approval. Results report total/returned matches, `nextOffset` pagination and current coverage; `path`/`container` narrow candidates. Call matches are name-based, not resolved runtime bindings. Use graph discovery followed by targeted source reads. Delivery guidance is phase-specific and recovery uses exact-obligation checkpoints plus current evidence; see [graph/context optimization](docs/graph-context-optimization.md) for behavior and pilot limitations.

**Choose the workflow.** The CLI defaults to `--workflow standard`: declare a complete acceptance contract and executable checks, implement, then run fresh checks and record a final snapshot review before finishing. `--workflow strict` additionally requires architecture/injection contracts, scenarios and tested-design approval before implementation; revisions relock that mode. Existing sessions keep their recorded mode, and direct extension hosts default to strict for compatibility. `delivery_probe` offers bounded Node/npm version discovery. This is a participating-tool boundary, not an OS sandbox. See [workflow modes and benchmark findings](docs/workflow-modes.md) and [strict design contracts](docs/tested-planning.md).

**Optional advisory research.** A dependency-injected Jev adapter and shadow evaluator are available off the normal delivery path. No credentials or provider call are required; classifier outputs cannot approve plans. See [measured fixture results and live-evaluation limits](docs/plan-advisor-evaluation.md).

**Adaptive plans.** Steps can be legacy strings or `{id,title,dependsOn:[],checks:[]}`. Structured steps use stable IDs, enforce dependency order, and require mapped checks before completion. `delivery_revise({reason,patch})` keeps omitted fields and replaces supplied arrays; unchanged checks retain fresh evidence only on unchanged source. New/remapped requirements still need new suite executions; old command evidence cannot automatically cover newly stated behavior. Intentionally-red regression milestones use `kind:"regression",checks:[]`, keeping green suites on final acceptance. Structured required plans must inspect/record a final diff-linked review. Changed source still invalidates all workspace evidence. Revisions preserve failure history and acceptance criteria rather than resetting the contract. See [medium/large-codebase workflows and limits](docs/planning.md).

**Headless monitoring.** `ctg --json -p "task"` streams engine JSONL events, including tool activity; `ctg status --json` returns a versioned report/fingerprint/completion snapshot. Text `-p` alone is not a live tool stream. Review receipts are traceable self-reports, not independent correctness proof.

**Informational vs delivery asks.** Every plan declares a verification classification. `required` (the default) is the delivery contract above. `advisory` retains optional informational evidence without a repair loop; it does not authorize new arbitrary command execution. New commands require a tested, approved `required` plan. `none` is a pure question/explanation with no checks at all. Informational plans finish with `delivery_finish` once (recorded as `advisory: true`) and never receive repair nudges; user-owned required validators always force `required`, and a `required` plan can only be reclassified before any check has run.

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

Browser evidence has two tiers: jsdom for DOM/unit checks (module scripts are rejected when execution is requested), and a real headless browser (bundled `chrome-headless-shell` over CDP, or an external WebDriver endpoint) for application modules and interactions. Browser checks subscribe to console errors before navigation and fail on unexpected console errors, exceptions and rejected promises. Screenshots are evidence to inspect, not automatic visual approval. See [browser setup and checks](docs/webdriver.md).

## Development

```sh
npm ci && npm run quality                  # lint, typecheck, build and tests; no model calls
npm run test:browser                       # bundled headless browser (auto-downloads on first use)
python3 -m pip install -r scenarios/game/requirements.txt && npm run test:python   # game graders
# Only with explicit spending authorization and a cap:
node evaluate.mjs --task cli --mode both --allow-live   # live A/B eval — spends API credit
```

Tests cover contract validation, stale evidence, required validators, timeouts/cancellation, compaction, actual-engine session budgets, report conflicts, and dashboard auth. Native CI covers Windows/macOS/Linux on Node 22/24; a separate Linux job runs the bundled real-browser suite. WSL JS/browser evidence is local and separate; WSL Python validation remains unperformed successfully. This does not establish all terminals or browsers as supported/tested. `PI_CLI` points the suite at a non-standard engine location.

See [repository quality gates](docs/quality.md) and [controlled evaluation readiness](docs/evaluation-readiness.md). Review admission is persistently bounded locally; delivery operations now share a workspace lock and explicit active-run pointer with same-run live reconciliation. See [coordination and recovery](docs/workspace-coordination.md) for limits and interrupted-lock handling. No controlled paid comparison yet establishes lower cost or fewer interventions for complete web deliveries.
