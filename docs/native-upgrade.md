# Native OpenCode preview: upgrade and migration guide

> **Status: preview / acceptance in progress.** `CTG_NATIVE=1` selects the
> native adapter for that process only. Without it, `ctg` still uses the
> existing CLI. No release version or tag is selected by this guide.

## Before you try it

- The native route uses the package-owned OpenCode **2.0.32** executable. It
  does not use, install over, update, or borrow authentication from a regular
  OpenCode installation. The native runtime is currently opt-in; do not change
  your shell-wide environment just to test it.
- Native OpenCode settings, auth, database/sessions, state, and cache belong to
  the CTG profile under `~/.carthagent/opencode/`. `CTG_OPENCODE_HOME` can
  override that profile root. The old CLI's Carthagent data is separate too.
  Project/worktree delivery reports and native task metadata live in their
  respective workspaces; task state is recorded in `.harness/`.
- Existing Pi sessions are **read-only archives**, not native sessions. There
  is no transcript continuation, conversion, or import. Keep the old
  installation and source data until you have independently confirmed the
  archive contains what you need.
- The migration is not yet accepted as the default. In particular, the pinned
  host's submitted `/help` command precedence and final-binary terminal
  acceptance have open items. See the [migration ledger](opencode-migration.md),
  [native compatibility matrix](native-compatibility.md), and
  [terminal evidence status](native-terminal-semantics.md#evidence-status-pr-162).

## Try the native route from a checkout

The current native preview instructions target a source checkout with its
dependencies installed; fresh npm-installed runtime resolution is not yet
accepted. In particular, the preview's hard-coded runtime lookup does not
currently resolve the hoisted OpenCode package layout in a fresh npm install.
The native installed-package resolver/install acceptance gate remains open in
the [migration ledger](opencode-migration.md#delivery-ledger); the npm install
form below must not be read as proof that this preview currently works from a
fresh global install. Install dependencies in a development checkout as its
contributor instructions require, then invoke the native route for one command
at a time:

```sh
CTG_NATIVE=1 node bin/ctg.mjs --help
CTG_NATIVE=1 node bin/ctg.mjs
CTG_NATIVE=1 node bin/ctg.mjs "Investigate the failing tests"
```

The flag is intentionally per invocation. `export CTG_NATIVE=1` or a persistent
shell profile setting routes all subsequent `ctg` invocations through the
preview. Omit it to return to the existing CLI. No command here installs a
runtime or changes your normal OpenCode profile.

The native launcher preserves familiar commands and aliases: `tui`/`ui`/
`interactive`, `resume`/`sessions`, `continue`, `status`/`s`, `check`/`c`,
`hash`/`fingerprint`, `login`/`auth`, `account`/`cloud`, `serve`/`web`/`start`,
and `update`/`upgrade`. See [native CLI](native-cli.md) for implemented flags,
failure behavior, and unsupported options. In particular, do not assume an old
flag is enforced merely because its name is accepted: unsupported `--bash-cap`
and `--isolate` fail closed, and policy/budget flags require enforcement
capabilities advertised by the active plugin.

## Projects, tasks, worktrees, and sessions

The native UI is based on OpenCode's project and session model. A CTG task
creates an OpenCode worktree and a separate root session located in that
worktree; CTG stores the task/parent relationship in workspace metadata. It
does not create a nested OpenCode child session. Worktree separation provides
independent checkout directories, but do not infer that every host, credential,
or external process behavior is isolated by a worktree.

Resume and continue operate on native sessions associated with the current
workspace. A project workspace view may present known task, worktree, and
session records together. These do not turn legacy transcripts into sessions.
Normal project discovery, host UI behavior, and complete cross-platform
interaction remain acceptance items; consult the ledger rather than assuming a
preview feature is fully supported.

## Legacy archive (read-only)

The archive CLI supports list/search/read/export. Configure or retain the
legacy session archive at its existing location; the native adapter exposes it
for reading and does not mutate those transcripts:

```sh
CTG_NATIVE=1 node bin/ctg.mjs archive list
CTG_NATIVE=1 node bin/ctg.mjs archive search "query"
CTG_NATIVE=1 node bin/ctg.mjs archive read <archive-id>
CTG_NATIVE=1 node bin/ctg.mjs archive export <archive-id> --format jsonl
```

Archive output is not an import format. Start a new native session and provide
any context you need yourself; no session identity or execution history is
carried forward.

## Headless commands and JSONL

`-p`/`--print` runs a headless task and prints assistant text. `--json` emits
JSONL lifecycle records for the selected native session, including tool starts,
tool results, completed assistant messages, and a terminal outcome. `ctg status
--json` is a separate versioned delivery status snapshot, not execution JSONL.
Headless invocations need a prompt; when stdout is not a TTY the CLI selects
headless mode automatically. A resume-picker request in headless mode becomes
continuation of the latest native session for that workspace.

```sh
CTG_NATIVE=1 node bin/ctg.mjs -p "Summarize this project"
CTG_NATIVE=1 node bin/ctg.mjs --json -p "Run the declared checks"
CTG_NATIVE=1 node bin/ctg.mjs status --json
```

JSONL consumers should use the terminal outcome and exit status, not the
presence of assistant text alone: successful completion requires the completed
assistant turn and a successful native terminal outcome. Failed, interrupted,
and unresolved turns are not success. `-p` text is not a live tool-event stream.

## Release installation and update

This guide does not publish a version and does not change release state. The
following is the exact-tag npm installation form for a future accepted release,
not a claim that a fresh npm installation currently passes native runtime
resolution. Once a version has actually been accepted, published, and tagged by
the release owner, the command is:

```sh
npm install -g --install-links=true github:B-icy/Carthagent#vX.Y.Z
```

Substitute only a real published `vX.Y.Z` tag. `ctg update --check` checks for
an available release. The native `ctg update` installs the validated exact
release tag only when Carthagent was installed as an npm package. Unlike the
currently-default legacy CLI updater, the native updater refuses to check out a
release into an active source clone even when it is clean. It will not force a
checkout or wipe edits. To update a development clone manually, preserve and
review any local work first, then fetch tags and check out the exact release
tag:

```sh
git status --short
git diff                         # review and preserve any edits before proceeding
git fetch origin --tags
git checkout --detach vX.Y.Z     # use an actual published tag; no force option
npm ci
```

Do not discard or overwrite local changes to make this procedure succeed. If
the checkout has work you need, commit it or preserve it outside the checkout
before changing revisions; resolve conflicts or recovery deliberately rather
than using a destructive reset. The updater is Carthagent's updater, not a
regular OpenCode updater. As long as native execution is opt-in, updating the
package does not change the CLI default. Do not install a branch or guess a
version to obtain a future native default.

## Acceptance status and help

The current acceptance contract and evidence are maintained in:

- [Migration delivery ledger](opencode-migration.md#delivery-ledger)
- [Native runtime acceptance matrix](native-compatibility.md)
- [Terminal probe and evidence caveats](native-terminal-semantics.md)
- [Unreleased native migration release-notes draft](release-notes-native-draft.md)

These documents intentionally distinguish component/test results from complete
installed-product acceptance. A command's presence, successful unit test, or
documentation entry does not by itself mark an acceptance gate complete.
