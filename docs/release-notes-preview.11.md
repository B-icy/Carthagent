# 1.1.0-preview.11 experimental release

Experimental preview. Install it explicitly with the experimental channel;
stable 1.0.7 is unchanged and published preview.10 remains immutable.

## What changes

**Projects / Voyages left pane (PR #230).** On a wide enough terminal the left
rail has two modes, **Projects** (the existing session list) and **Voyages**.

- Switching modes keeps the current page. It does not create, interrupt, or
  close a coding session, and it does not change the session or draft.
- The Voyages navigator shows read-only profile and daily assignment
  summaries. Select an entry explicitly to open its detail page. Opening a
  quest does not compose evidence or grant consent. **Return to coding** opens
  the selected session, or Home when no session is selected.
- Each mode keeps its own selection and scroll position, and the chosen mode
  is restored after a normal restart (without reopening a detail page).
- **Focus pane** (or the configured shortcut) moves keyboard focus into the
  pane; `Escape` returns focus to the page. Clicking a page control while the
  pane is focused keeps focus on that control.
- The compact rail uses `Q` (quests), `P` (profile), `E` (equipment),
  `R` (refresh), `S` (sign in) and `B` (return to coding); numbered rows are
  actual assignments. When the terminal is too narrow for the rail, use the
  command palette, `/voyages`, or `/quests`.
- Badges and friends have no native views yet. The pane never invents links or
  data the server did not return.

**Dialog resize fix.** Select dialogs no longer register one terminal-resize
listener per row, which produced `MaxListenersExceededWarning` in large lists.

Daily coding quests, Ship, Lite and the native default `ctg` interface behave
as in preview.10. Assessments still award no coins, XP, or other rewards.

## Provenance

| Input | Exact value |
| --- | --- |
| Package | `1.1.0-preview.11` |
| Prebuild source | `47fe2a6d52492f5f614a704605486ec6e8ed9f79` |
| Prebuild workflow run | [41145521256](https://github.com/B-icy/Carthagent/actions/runs/41145521256) |
| Full manifest SHA-256 | `6afe56eff1d2d08e798c7e329e817a980f7184a47bbb771c2a3e231eb3687862` |
| Upstream revision | `843a6c514e606b436a7fe713422ace0a93ad3d61` |
| CTG patch (combined-v4) SHA-256 | `1f2309bb3a31dfb8e8a0827a6a1144a1f76a005abff58f6f48857639ec02478a` |
| Lock SHA-256 | `9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d` |
| Runtime / compatibility | `0.0.0-ctg.2.0.32` / `2.0.32` |

All five native prebuilds (Linux x64/arm64, macOS x64/arm64, Windows x64)
passed the full runtime typecheck and the build recipe's test list in one run.

Two tests that are timing-sensitive on CI were hardened. Neither change touches
product code:

- `navigation-rail`: waits for the pane's status text to refresh on the next
  render pass instead of reading it immediately after a click.
- `plugin-source` (real watchers): confirms the helper watch is live before
  the atomic save. On the current `macos-15-arm64` runner image, a macOS file
  watcher can miss a write made immediately after it starts.

## Trying it

```sh
ctg update --channel experimental --check
ctg update --channel experimental
ctg --version   # 1.1.0-preview.11
```

Or install the exact tag:

```sh
npm install -g --install-links=true github:B-icy/Carthagent#v1.1.0-preview.11
```

`ctg update --channel stable` returns to stable 1.0.7 without `--force`. See
the [upgrade guide](native-upgrade.md) for profile preservation. Historical
[preview.10 notes](release-notes-preview.10.md) are retained unchanged.
