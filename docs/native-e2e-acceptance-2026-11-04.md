# Beta.7 candidate acceptance

This records the November 4 follow-up to beta.6. Five-platform prebuild, final PR CI, draft installed acceptance, and published anonymous-download acceptance passed. GitHub beta.7 is public and the release workflow successfully submitted npm publication with signed provenance.

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
| Repository quality | 1,146 passed; 5 skipped | Lint, build, typechecks, Node unit/integration tests; includes main's analytics/CI changes |
| Full native runtime TUI | 1,613 passed; 2 skipped | 189 files, 109,221 assertions, 2 snapshots |
| Plugin renderer | 33 passed; 170 assertions | Quest, Voyages, navigation, commands, session preferences |
| Browser integration | Passed | Module execution, click, Unicode, screenshot, broken-module failure |
| Python | 28 passed | Extracted Ubuntu Pillow 9.0.1; CI uses its pinned dependency version |
| Native slash commands | Passed on rebuilt candidate | Export/escaping, session stats (17 input/9 output), guide prompt/toggle, raw framing bypass, workflow/architecture/evidence routes |
| Native fixture batch | All 19 rebuilt probes passed | Host, models, Ship walkthrough, default CLI, product, runtime, tasks, review, report, controls, outcomes, daily quests, reconnect, SWE, evaluation, PTY, glyphs, slash commands |
| Signed-in terminal | Passed checks below | Original acceptance profile, actual Windows Terminal captures |

Native screenshots are under `~/.local/share/carthagent-acceptance/beta5-ux-review/native/`:

- 194–196: direct new-session path accepted with one Enter; no session created before a prompt.
- 203: existing transcript and session preserved.
- 208–209: restart, colored Ship/Lite/Plan/Build modes, readable Voyages selection, Friends WIP.
- 210–211: unvisited durable recorded work discovered and selected after restart; stale checks shown clearly.
- 212–215: wide and 60×20 shop categories, item preview, insufficient-balance state.
- 217–219: compact navigation, owned-item preview, explicit equip confirmation; canceled without mutation.
- 220–223: compact Coding return, authenticated account and usage, Builder $1 first month/$10 renewal confirmation; canceled before checkout.

Daily quests remain separate from verified Ship rewards. No quest submission, purchase, equipment change, or customization was committed in these checks.

Sequential candidate and installed beta.7 account reads using the original normal and acceptance profiles authenticated to the same accounts as beta.6. Credential identity metadata, all 10 project rows, 3 sessions, and 61 transcript messages were preserved. OAuth values/update timestamps may rotate during refresh and are not compared as immutable records. Installed preservation used the exact CI-built release runtime; the separate CI gates exercised default acquisition.

## Candidate provenance

- Upstream source: `843a6c514e606b436a7fe713422ace0a93ad3d61`.
- Combined/development v9 patch: `eda717ebe6b5d258b3c79153a23130b0f267491bc145cae8da183f2284a25e3e`.
- Patched tree: `364d553fc1b4f74956ab5b1c3a485d155e2d0514`.
- Initial local Linux executable (before the Windows path-normalization fix): `228e8f600b6a784bf7b998254c2421c8b3e1774259cffc2f55d2e8a7e214bd5d`.
- Runtime: `0.0.0-ctg.2.0.32`; Bun 1.4.2; OpenTUI 0.5.17.

## Outstanding release gates and limits

Five-platform prebuild [41801398244](https://github.com/B-icy/Carthagent/actions/runs/41801398244) passed at source `eca43034a28f6006b4d339c87fa2c9150e4840dd`. All archive hashes verified locally. Its manifest is promoted unchanged for beta.7; combined-v8 remains unchanged. The Linux release executable is `a3c07f23118a3121c4e5f8012d2aea9bdd1d80483b24f0d26ea24dcea99bc98f`.

## Final release evidence

- [PR #253](https://github.com/B-icy/Carthagent/pull/253) merged as `72829a1857bcc649cf92aae10df52059feae1a6a` after [all nine PR CI jobs passed](https://github.com/B-icy/Carthagent/actions/runs/41804379403). Initial download failures preceded draft asset upload; the failed jobs passed after upload.
- Immutable release tag: `v1.1.0-beta.7` at `dcfc4e04aac066b70f4f7f241a0d3c6136f071c1`.
- [Draft acceptance](https://github.com/B-icy/Carthagent/actions/runs/41805902929): full repository quality and non-focused installed/default-resolver gate passed, with draft identity and tag ancestry checked before and after.
- [Published acceptance and npm publication](https://github.com/B-icy/Carthagent/actions/runs/41806815554): full installed gate passed through anonymous runtime acquisition; npm accepted `carthagent@1.1.0-beta.7` with signed provenance and the `next` tag.
- [Public GitHub prerelease](https://github.com/B-icy/Carthagent/releases/tag/v1.1.0-beta.7): all five archives and manifest digests match the promoted pins.
- Exact release Linux slash-command acceptance passed. Installed authenticated profile preservation passed for both original profiles.
- Stable `latest` remains `1.0.7`. npm publication may take several minutes to propagate after the workflow succeeds.

The first prebuild passed Linux and macOS on both architectures but failed Windows new-session tests. An unchanged path was compared in normalized versus original form, incorrectly marking it dirty. Both sides now use identical normalization, with an additional equivalent-path regression. All 68 sidebar regressions and typecheck passed locally; the revised five-platform prebuild passed on every platform.

The earlier 44-item checklist is not fully recertified. Historical completed-run browsing, lost-profile recovery, live oversized evidence, forced mid-upload termination, and real payment completion/explicit continuation remain outside this pass. Offline billing tests do not constitute a live payment. No claim is made that every possible UI state or external-provider outcome has been exercised.
