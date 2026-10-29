# Native OpenCode preview: upgrade and migration guide

The unpublished **1.1.0-preview.9 candidate** inherits native by default from
preview.8. This is not an installable-release announcement. `ctg native` is a compatibility
alias; `CTG_NATIVE` no longer selects a different console. Stable 1.0.7 remains
the legacy release. Install previews only through an explicit experimental
channel switch or an exact published tag.

See the [preview.9 candidate notes](release-notes-preview.9.md) for current
evidence. Until publication, use the explicit reviewed-artifact procedure in
the [manual testing guide](native-manual-testing.md), not the public resolver.

## Before you try it

- The native route uses a checksum-pinned CTG-owned runtime compatible with OpenCode **2.0.32**. It
  does not use, install over, update, or borrow authentication from a regular
  OpenCode installation. Selecting the experimental release is explicit; no shell-wide routing toggle is needed.
- Native OpenCode settings, auth, database/sessions, state, and cache belong to
  the CTG profile under `~/.carthagent/opencode/`. `CTG_OPENCODE_HOME` can
  override that profile root. The old CLI's Carthagent data is separate too.
  Project/worktree delivery reports and native task metadata live in their
  respective workspaces; task state is recorded in `.harness/`.
- Existing Pi sessions are **read-only archives**, not native sessions. There
  is no transcript continuation, conversion, or import. Keep the old
  installation and source data until you have independently confirmed the
  archive contains what you need.
- Read the exact release notes for installed-package acceptance and platform
  limitations. Earlier migration findings remain in the
  [migration ledger](opencode-migration.md) and
  [terminal evidence](native-terminal-semantics.md); they are historical evidence,
  not a claim that every command or platform has been verified by a live model.

## Try the native route from a checkout

The default resolver acquires only the platform archive pinned by the packaged
release manifest, validates source/patch/lock and archive/executable checksums,
and caches it in the private Carthagent profile. It never falls back to a system
or upstream binary after selecting the owned runtime. An explicit developer
artifact is a separate, validated staging path—not an end-user update mechanism.

After installing dependencies in a checkout of a published source tag:

```sh
node bin/ctg.mjs --help
node bin/ctg.mjs
node bin/ctg.mjs "Investigate the failing tests"
```

The native service refreshes after a verified owned runtime or launcher update.
Sessions and credentials remain in the profile; an unauthenticated or foreign
process is never stopped just because its registration looks stale.

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
node bin/ctg.mjs archive list
node bin/ctg.mjs archive search "query"
node bin/ctg.mjs archive read <archive-id>
node bin/ctg.mjs archive export <archive-id> --format jsonl
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
node bin/ctg.mjs -p "Summarize this project"
node bin/ctg.mjs --json -p "Run the declared checks"
node bin/ctg.mjs status --json
```

JSONL consumers should use the terminal outcome and exit status, not the
presence of assistant text alone: successful completion requires the completed
assistant turn and a successful native terminal outcome. Failed, interrupted,
and unresolved turns are not success. `-p` text is not a live tool-event stream.

## Release installation and update

Only published releases are installable; a draft is not an update. From an
installation with channel support:

```sh
ctg update --channel experimental --check
ctg update --channel experimental
ctg
```

Only after `v1.1.0-preview.9` and its reviewed assets are published, its exact-tag
installation form will be:

```sh
npm install -g carthagent@1.1.0-preview.9
```

Do not run this for the unpublished candidate. `ctg update --check` checks for
an available release. `lib/opencode/update.mjs` contains the shared,
release-validated update operation: for npm-installed Carthagent it installs
the validated exact release spec; for a source clone it requires a clean
working tree, fetches the selected origin tag into a private ref, resolves that
fetched tag to a commit, checks out the commit detached, then reinstalls
dependencies and the global package. It does not overwrite existing local tags
or proceed with dirty files. The native CLI's current `update` command path is
separate: it installs the validated release spec for npm installs and refuses
to check out into its active source tree, including a clean clone. Use the
non-forced manual procedure below for that source-tree path; do not assume
uncomposed CLI/UI wiring changes this behavior. Preserve and review local work
first:

```sh
git status --short
git diff                         # review and preserve any edits before proceeding
git fetch origin --tags
git checkout --detach v1.1.0-preview.9  # only after publication; no force option
npm ci
```

Do not discard or overwrite local changes to make this procedure succeed. If
the checkout has work you need, commit it or preserve it outside the checkout
before changing revisions; resolve conflicts or recovery deliberately rather
than using a destructive reset. The updater is Carthagent's updater, not a
regular OpenCode updater. Preview.9 inherits the native-default CLI from preview.8.
Use `ctg update --channel stable` to return to the legacy stable release; neither
channel switching nor service refresh deletes profiles or legacy transcripts.
Do not install a moving branch or guess an unpublished version.

## Acceptance status and help

The current acceptance contract and evidence are maintained in:

- [Preview.9 candidate notes and remaining release gates](release-notes-preview.9.md)
- [Historical migration delivery ledger](opencode-migration.md#delivery-ledger)
- [Native runtime acceptance matrix](native-compatibility.md)
- [Terminal probe and evidence caveats](native-terminal-semantics.md)
- [Historical native migration draft (not current routing/install guidance)](release-notes-native-draft.md)

These documents intentionally distinguish component/test results from complete
installed-product acceptance. A command's presence, successful unit test, or
documentation entry does not by itself mark an acceptance gate complete.
