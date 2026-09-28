# Tested planning before code

New and resumed delivery tasks must test and approve their design before generating product code, tests or executable prototypes. A plan's existence is no longer permission to implement. `--delivery-strict=false` does not bypass this policy.

## Sequence

1. Discover with built-in `read`, `ls`, `find`, `grep`. Shell and unknown/custom tools are blocked before approval, including apparently read-only shell commands. No isolated baseline runner is supplied; do not claim preapproval commands ran.
2. Call `delivery_plan` with the existing acceptance/check contract and `design` below. Planning data is persisted by the harness, not arbitrary file writes.
3. Call `delivery_design {action:"validate"}`. Resolve blocking diagnostics using `delivery_revise`.
4. Record `delivery_design {action:"review",review:{challenges,walkthroughs,findings,limitations}}`. Walk through **every** scenario with `{scenario,trace,assertion}`. Findings have `severity:"blocking"|"advisory"`, `description`, and an explicit `disposition` for advisory findings. Review is model-authored, not independent proof.
5. Call `delivery_design {action:"approve"}` only after challenges and iterations. The approval is bound to run, revision, full plan digest and source fingerprint.
6. Generate regression tests, implement, run checks, and complete final diff-linked review. Existing evidence rules and user-owned validators remain authoritative.

Revisions always relock implementation. Source edits before the first authorized implementation action stale approval. Once implementation starts, planned source edits do not require approval after each keystroke; they still invalidate final verification evidence. Resume restores receipts. Legacy reports remain readable but cannot authorize new commands or writes without a tested design.

Informational plans still finish without a repair loop, but cannot authorize arbitrary process execution. Consequently `advisory` checks cannot be newly executed through the delivery runner without a required, approved design. Existing advisory evidence remains readable. Use `none` for read-only answers.

## Design fields

`design` is planning data, not executable code:

- `components`: `{id,responsibility,excludes:[],layer,dependencies:[],externalDependencies:[],requirements:[]}`. Layers: `core`, `adapter`, `composition`, `presentation`. Requirements use exact acceptance text. Declare explicit non-responsibilities. Core components cannot depend on concrete adapters; `externalDependencies` name owned ports.
- `ports`: `{id,owner,adapter,compositionRoot,input,output,errors,injection,testDouble,integrationAssertion}`. Owner/adapter/compositionRoot reference component IDs. Declare contracts and where dependencies are injected. Real adapter assertions complement test doubles.
- `scenarios`: `{id,requirement,kind,path:[],input,expected,assertion,checks:[]}`. Kinds: `positive`, `failure`, `boundary`. Every requirement needs a positive and failure/boundary scenario. Paths name components; checks name existing executable suites. Specify observable assertions, not implementation descriptions.
- `risks`: `{id,description,status:"open"|"resolved",blocking:boolean,evidence?}`. Blocking open risks prohibit approval; resolved risks need evidence.

SRP means cohesive ownership/reasons to change, not mechanically one function per file. Contract validation detects missing declarations and contradictions, not undeclared hidden dependencies or semantic inadequacy.

## Agent-authored workflow

Optional `workflow:{nodes:[],recovery:[]}` is the canonical graph, not free-form executable D2. Each node declares `{id,title,type,dependsOn:[],requirements:[],components:[],checks:[],inputs:[],artifacts:[],effects:[]}`. Types: `work`, `decision`, `check`, `artifact`. Work nodes reference a `step` (structured ID or `legacy_1` etc.); every step must appear. Decisions declare `condition`; check nodes need check IDs. Effects are `read`, `write`, `execute` declarations, not permissions. IDs beginning `gate_` are reserved.

Prerequisites form a DAG. Recovery transitions declare `{from,to,when,maxAttempts,stop}` with 1–10 attempts. These are proposed bounded recovery routes, **not an executable scheduler**; the agent still performs actions through gated tools and session budgets. D2 is generated from this validated graph. The harness overlays design approval, fresh verification, final review and handoff gates; the model cannot remove those. Legacy plans retain their old D2 and have a canonical fallback projection. Architecture is a separate component/dependency/port projection.

## Workflow, architecture and evidence views

The dashboard Plan panel has three selectable views and a pinned revision/lock explanation. Workflow shows observed current work, node states and recovery routes; architecture shows responsibilities, non-responsibilities, dependency direction and injection contracts; evidence shows execution revisions, logs and stale/failed status. Check buttons are disabled while approval is locked. Proposed decisions/artifacts are never inferred successful.

The terminal supports `/workflow`, `/architecture` and `/evidence` in the side pane. Report-file/tool-result updates refresh the shared projection; dashboard status polling consumes that same projection. This is observed-state refresh, not a claimed ordered event stream. `ctg status --json` includes `planningView` for other consumers. A passing command or an approved plan remains distinct from semantic correctness.

## API and enforcement scope

`POST /api/design` accepts the same action/review fields under the dashboard's authentication and workspace lock. `/api/checks/run`, `ctg check`, and `delivery_check` enforce the same approval policy. Participating tool calls are fail-closed before approval; this is **not an OS sandbox**. External processes, trusted host/extensions, tool-name replacement, raw API state-file tampering and postapproval unexpected edits are outside the guarantee. A tool hook does not hold a cross-process lease for an arbitrary tool's entire execution; avoid concurrent sessions editing one workspace.

Implementation status, blockers and receipts are available through `delivery_status`, report JSON and `/api/status`. See the [six-stage roadmap](tested-planning-roadmap.md) for rollout and outstanding stages. Historical trial notes retain the behavior and failures observed at their original revisions.
