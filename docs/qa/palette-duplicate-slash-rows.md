# Duplicate `/resume` and `/review` slash rows

Black-box QA of 1.1.0-beta.8 (Nov 9, 2026) found two rows each for `/resume`
and `/review` in slash autocomplete:

| Row | Source | What typing the name runs |
| --- | --- | --- |
| `/resume` — "Search and resume a session in this folder" | Carthagent plugin (`[id\|name]`) | this one |
| `/resume` — "Switch session" | host `session.list` alias (`sessions`, `resume`, `continue`) | never |
| `/review` — "Fresh-context review; ask\|yes\|no sets default" | Carthagent plugin | this one |
| `/review` — "review changes [commit\|branch\|pr], defaults to uncommitted" | host server command | never |

Prompt submission resolves an argument-taking keymap slash command before
server commands, so the second row of each pair could not be reached by
typing. The plugin API can add but not remove host commands, so the fix is in
the owned runtime.

## Fix

`combined-v14` (published candidate) and `development-v19` (source preview)
are `combined-v13`/`development-v18` plus one change to
`packages/tui/src/component/prompt/autocomplete.tsx` and a new
`packages/tui/src/prompt/slash-options.ts`:

- one keymap row per slash name, preferring the argument-taking command that
  submission runs, otherwise the first reachable one;
- a server command is hidden when an argument-taking keymap slash command
  claims its name, and repeated server names are listed once.

`/sessions` and `/continue` still list the host session switcher; `/init` and
other server commands are unchanged.

## Verification

- New `test/prompt/slash-options.test.ts` and a `plugin-keymap` fixture test
  that renders the real autocomplete with a plugin claiming `/resume` and
  `/review` next to a host `/review` server command. The fixture test fails on
  `combined-v13` (two `/review` rows) and passes on `combined-v14`.
- `packages/tui` typecheck passes. Full `packages/tui` suite on v13+fix with
  Bun 1.4.2 on Linux ARM64: 1647 pass, 2 skip, 3 fail. The 3 failures
  (`new-session-id`, `app-lifecycle` launch-directory cases) fail identically on
  unmodified `combined-v13` in this environment.

## Shipping

`lib/opencode/runtime-release.json` and `CTG_RUNTIME_PATCH_SHA256` still pin
the published beta.8 runtime (`combined-v13`). Users get the fix after the next
prebuild → publish → release promotes a runtime built from `combined-v14`.
