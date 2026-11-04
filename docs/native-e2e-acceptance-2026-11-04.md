# Beta.7 candidate acceptance

This records the November 4 follow-up to beta.6. Publication and installed release acceptance are still pending.

## Fixes

- Readable selected Projects/Voyages tabs, filled Browse/New session actions, compact sidebar spacing, and two-line session status.
- Editable new-session paths with completion and an Agent of Empires-style folder picker (current/parent folders, arrows, single-click opening).
- Readable Voyages menu selection.
- Quest source selection reads the paginated durable session inventory, including sessions not visited since restart. Evidence provenance uses the discovered session metadata.
- Runtime regression fixtures now match Carthagent branding, vertical/global defaults, colored mode labels, current provider nesting, and coordinate-independent transcript interaction.
- Slash acceptance selects no-argument commands once, waits for the guide-toggle provider request, and verifies explicit fixture token counts.

## Coverage

| Layer | Result | Scope |
| --- | --- | --- |
| Repository quality | 1,144 passed; 5 skipped | Lint, build, typechecks, Node unit/integration tests |
| Full native runtime TUI | 1,613 passed; 2 skipped | 189 files, 109,221 assertions, 2 snapshots |
| Plugin renderer | 33 passed; 170 assertions | Quest, Voyages, navigation, commands, session preferences |
| Browser integration | Passed | Module execution, click, Unicode, screenshot, broken-module failure |
| Python | 28 passed | Extracted Ubuntu Pillow 9.0.1; CI uses its pinned dependency version |
| Native slash commands | Passed on rebuilt candidate | Export/escaping, session stats (17 input/9 output), guide prompt/toggle, raw framing bypass, workflow/architecture/evidence routes |
| Native fixture batch | Initial 18 probes passed; final rebuilt batch pending | Host, models, Ship walkthrough, default CLI, product, runtime, tasks, review, report, controls, outcomes, daily quests, reconnect, SWE, evaluation, PTY, glyphs |
| Signed-in terminal | Passed checks below | Original acceptance profile, actual Windows Terminal captures |

Native screenshots are under `~/.local/share/carthagent-acceptance/beta5-ux-review/native/`:

- 194–196: direct new-session path accepted with one Enter; no session created before a prompt.
- 203: existing transcript and session preserved.
- 208–209: restart, colored Ship/Lite/Plan/Build modes, readable Voyages selection, Friends WIP.
- 210–211: unvisited durable recorded work discovered and selected after restart; stale checks shown clearly.
- 212–215: wide and 60×20 shop categories, item preview, insufficient-balance state.
- 217–219: compact navigation, owned-item preview, explicit equip confirmation; canceled without mutation.

Daily quests remain separate from verified Ship rewards. No quest submission, purchase, equipment change, or customization was committed in these checks.

## Candidate provenance

- Upstream source: `843a6c514e606b436a7fe713422ace0a93ad3d61`.
- Combined/development v9 patch: `bf9dd691e21d87344b38b6b42ceca2886e47614e96d1d39c23e3b16c3ad63293`.
- Patched tree: `53684031f3a8c4735d39dd027471e19176a7fb3a`.
- Local Linux executable: `228e8f600b6a784bf7b998254c2421c8b3e1774259cffc2f55d2e8a7e214bd5d`.
- Runtime: `0.0.0-ctg.2.0.32`; Bun 1.4.2; OpenTUI 0.5.17.

## Outstanding release gates and limits

Five-platform prebuild, promoted manifest, installed/default-resolver acceptance, authenticated upgrade preservation, and publication remain pending. The published beta.6 manifest and combined-v8 patch are retained unchanged during candidate preparation.

The earlier 44-item checklist is not fully recertified. Historical completed-run browsing, lost-profile recovery, live oversized evidence, forced mid-upload termination, and real payment completion/explicit continuation remain outside this pass. Offline billing tests do not constitute a live payment. No claim is made that every possible UI state or external-provider outcome has been exercised.
