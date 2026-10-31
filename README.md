# Carthagent

Carthagent checks software work against real acceptance tests and re-proves it whenever source changes.

## Install

```sh
curl -fsSL https://carthagent.xyz/install | sh
irm https://carthagent.xyz/install.ps1 | iex
npm install -g carthagent
```

Node.js 22.19+ is required for the npm install. From source: `npm install -g --install-links=true github:B-icy/Carthagent#vX.Y.Z` (replace with a published tag).

See [workflow.svg](docs/workflow.svg) for the flow and [evaluation history](docs/evaluation.md) for trials, including failures.

## Native CLI

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

Native Voyages landed in PR #225. Live development-runtime testing exercised
browser device approval, name cancel/save, owned Beanie equip, restart and web
persistence, expiry recovery, and revocation. The approving web player remains
authoritative. The tested wallet had 10 coins and no affordable paid quote:
no live paid debit or replay was proven. These are historical, bounded source/runtime
results, not preview.10 installed-package acceptance. Subsequent development-runtime
testing completed one explicitly authorized 40-coin purchase and restart
persistence; see the [preview.10 candidate notes](docs/release-notes-preview.10.md)
for its limits. Published preview.9 remains immutable and does not acquire
changes from current main.

### Projects sidebar source preview (development only)

The redesigned Projects sidebar (folder card, folder browser, and folder/model
setup for new sessions) exists only as source. It is **not** in any published
`ctg` release, and the steps below do not build or update the published native
runtime. The published runtime stays pinned to
`docs/patches/opencode-v2.0.32-session-ui-combined-v4.patch` and
`lib/opencode/runtime-release.json`.

Requirements: Git, a POSIX shell, `sha256sum` or `shasum`, Bun 1.4.2 (the
OpenCode `packageManager` pin), and this checkout with `npm ci` already run. No
native compilation is needed.

1. Prepare a clean OpenCode checkout at the pinned upstream and apply the
   development patch (v5 replaces v4 and applies directly to upstream):

   ```sh
   git clone https://github.com/anomalyco/opencode "$HOME/src/opencode preview"
   git -C "$HOME/src/opencode preview" checkout 843a6c514e606b436a7fe713422ace0a93ad3d61
   script/ctg/prepare-development-runtime.sh "$HOME/src/opencode preview"
   (cd "$HOME/src/opencode preview" && /path/to/bun-1.4.2 install)
   ```

2. Launch from any directory with explicit paths (spaces are fine):

   ```sh
   /path/to/carthagent/script/ctg/source-preview.sh \
     --source "$HOME/src/opencode preview" \
     --profile "$HOME/.carthagent/source-preview" \
     --bun /path/to/bun-1.4.2 \
     --workspace "$HOME/projects/my project"
   ```

   The launcher runs `bun --no-env-file run src/index.ts --standalone <workspace>`
   from `packages/cli` with only a private HOME, TMPDIR, XDG and OpenCode config
   directory inside `--profile`. It disables project config and auto-update and
   passes no inherited API keys. On first use it creates the profile (mode 0700)
   with the Carthagent plugin, Carthage theme and CLI theme config. Existing
   profile files are never rewritten. The private server listens on an ephemeral
   loopback port and exits when the TUI exits.

3. Sign in once inside the same profile. Enter secrets only at the terminal
   prompt, never as arguments:

   ```sh
   script/ctg/source-preview.sh --source ... --profile ... --bun ... -- auth login
   ```

In the TUI, the folder card at the top of Projects shows the current folder and
model. Use **Browse** (or `/browse`) to pick a folder and **Ctrl+S** to confirm.
**New session** opens folder and model setup; the session is created only when
you send the first message. Leave with `/exit` (or Ctrl+P, “Exit the app”); relaunch with
the same `--profile` and choose the session in Projects to continue it.

See [source preview](docs/source-preview.md) for testing, patch verification and
limits.

## Install and update

The installer selects an exact published release and acquires its pinned native runtime; it never falls back to an unrelated system binary. See the [native upgrade guide](docs/native-upgrade.md) for source-checkout and profile-preservation instructions, or [legacy CLI instructions](docs/legacy-cli.md) for stable 1.0.7.

`ctg update --check` checks for a published release without installing. Select `--channel experimental` to include published previews; drafts are never installed. The legacy stable updater can update a clean source clone. The native updater differs: it refuses to check out a release into any active source clone, including a clean one; it installs package releases only from an npm installation. Preserve local changes and use the manual exact-tag checkout procedure in the [native upgrade guide](docs/native-upgrade.md) when updating a development checkout. Published previews are immutable. See the [preview.11 release notes](docs/release-notes-preview.11.md); the older [native migration draft](docs/release-notes-native-draft.md) is historical, not current installation guidance.

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

## Release status

1.1.0-preview.12 is the current experimental release. It republishes
preview.11 with an npm package that keeps the `ctg` command, plus a release
check that blocks manifests npm would rewrite. Preview.11 added a Projects /
Voyages mode switch to the native left rail, with read-only Voyages profile and
daily assignment summaries, on top of preview.10's native daily coding quests
(selected evidence, exact-payload preview, fresh per-submission consent, and
durable recovery; assessments do not award rewards). Native remains the default
`ctg` interface. Ship retains approval, checks, review, repair, recovery, and
resume; Lite remains direct execution. Published previews are immutable.
Experimental installation is explicit and selects published releases only;
stable 1.0.7 retains the legacy console.

Each experimental release must pass its exact installed-package gate before
publication. See the [preview.12 release notes](docs/release-notes-preview.12.md),
[preview.11 notes](docs/release-notes-preview.11.md), and [preview.10 notes](docs/release-notes-preview.10.md); earlier migration findings and remaining platform caveats
are in the [Native migration ledger](docs/opencode-migration.md#delivery-ledger),
[native compatibility matrix](docs/native-compatibility.md), and [terminal
evidence status](docs/native-terminal-semantics.md#evidence-status-pr-162).

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
