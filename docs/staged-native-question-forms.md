# Staged native question forms (source only)

This is a source-patch review, not a runtime release or an installation guide.
The intended candidate preserves invocation-local services through Promise tool
wrappers and bounds long native forms with a scrollable body and reachable
actions. The frozen source checks and independent packaging results are recorded
below. Complete canonical source verification is blocked by missing website
dependencies. Local compiled-runtime interaction passed separately, as recorded
below; released-product acceptance remains pending. Static patch assertions do
not establish those outcomes.

## Inputs and immutable release boundary

- Carthagent staging baseline: `244dc99`, branch `fix/native-question-forms`.
- Upstream source: `843a6c514e606b436a7fe713422ace0a93ad3d61` (OpenCode 2.0.32).
- Upstream lock SHA-256: `9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d`.
- Toolchain: Bun `1.4.2`.
- Candidate: `docs/patches/opencode-v2.0.32-session-ui-combined-v16.patch`.
  It must be the complete diff against the upstream revision above, not a delta
  to apply over combined-v15, and not the separate development-v16 patch.
- Candidate Git tree: `c67d50a38ff2bde0f55ea15c0ffb743147c8be0e`.
- Source inventory SHA-256: `6d44698533dd2fcecfe68a0da7016e65ba1add5a59b5ed5c33ee6d583a1cf2d9`.
- Composite provenance SHA-256: `3e8886e2d75f66efca26df25710c652ed045c2699639160c105bebe529aaf720`.

Candidate patch SHA-256: `f16cd344844f20ae978519388333d2ca3b99165fd4f7b8120eb36c3f3ce8d7c4`.

The documentation is the candidate input-hash record; the focused test computes
the actual digest and compares it here rather than introducing another candidate
pin in executable configuration.

The released patch remains
`docs/patches/opencode-v2.0.32-session-ui-combined-v15.patch`, SHA-256
`eb6feae3931d78a2ff572b63a2186c63f0300ca2ee4b7808d96bb270c65ec3f0`.
These files must remain unchanged in this source-only change:

- `script/ctg/build-owned-runtime.sh` (still builds combined-v15).
- `.github/workflows/publish-owned-opencode-runtime.yml` (still selects v15).
- `lib/opencode/runtime.mjs` (both released and development pins unchanged).
- `lib/opencode/runtime-release.json` (release 1.1.1 and archive/executable trust
  pins unchanged).

Do not dispatch prebuild/publish, generate a replacement release manifest,
install globally, change normal profiles or weaken the resolver to accept v16.
The existing development-v20 path is separate and is not this candidate.

## Manual source application and round trip

Use an already available upstream repository containing the pinned commit and a
new disposable worktree. No network operation is needed for these checks. The
parent's final provenance record must supply the expected patch digest; comparing
an unreviewed file only to its own freshly calculated hash is not provenance.
The following Bash example checks the reviewed candidate digest. Replace the
three absolute paths before execution. Keep logs outside
the upstream worktree so its pristine check remains meaningful.

```bash
set -euo pipefail
CTG=/absolute/path/to/reviewed/carthagent-checkout
UPSTREAM=/absolute/path/to/existing/opencode-repository
CANDIDATE=/absolute/path/to/new/disposable-question-source
SOURCE=843a6c514e606b436a7fe713422ace0a93ad3d61
PATCH="$CTG/docs/patches/opencode-v2.0.32-session-ui-combined-v16.patch"
EXPECTED_PATCH=f16cd344844f20ae978519388333d2ca3b99165fd4f7b8120eb36c3f3ce8d7c4
[[ "$EXPECTED_PATCH" =~ ^[a-f0-9]{64}$ ]]
printf '%s  %s\n' "$EXPECTED_PATCH" "$PATCH" | sha256sum --check
test ! -e "$CANDIDATE"
git -C "$UPSTREAM" -c core.autocrlf=false worktree add --detach "$CANDIDATE" "$SOURCE"
test "$(git -C "$CANDIDATE" rev-parse HEAD)" = "$SOURCE"
test -z "$(git -C "$CANDIDATE" status --porcelain --untracked-files=all)"
printf '%s  %s\n' 9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d "$CANDIDATE/bun.lock" | sha256sum --check
git -C "$CANDIDATE" apply --check "$PATCH"
git -C "$CANDIDATE" apply "$PATCH"
git -C "$CANDIDATE" apply --reverse --check "$PATCH"
git -C "$CANDIDATE" apply --reverse "$PATCH"
test -z "$(git -C "$CANDIDATE" status --porcelain --untracked-files=all)"
git -C "$CANDIDATE" apply "$PATCH"
git -C "$CANDIDATE" diff --check
git -C "$CANDIDATE" status --short
```

On macOS, use `shasum -a 256 --check` in place of `sha256sum --check`.
Compare the applied tree, including newly added files, against the final
source-provenance inventory. A clean apply/reverse round trip proves patch
applicability, not equivalence to an unrecorded source tree or behavioral fixes.
Keep the evidence until handoff; do not reset or clean a pre-existing checkout.

## Candidate-only build preparation

Do not run the active Carthagent build recipe expecting it to select v16.
If a local compiled candidate is needed, use a **second pristine disposable
upstream worktree** at the same source revision: the recipe applies the patch
itself, so the already patched tree above is not a valid build input.

Copy the existing recipe into that worktree at
`script/ctg/build-owned-runtime.sh`, copy `tools/run-native-test-stress.mjs`, and
copy the reviewed v16 bytes into the matching `docs/patches/` path. Edit only
the copied recipe, review its diff and record its digest outside the worktree:

1. Replace every `opencode-v2.0.32-session-ui-combined-v15.patch` reference with
   `opencode-v2.0.32-session-ui-combined-v16.patch`, including the input allowlist.
2. Replace `EXPECTED_PATCH` with the reviewed candidate digest above. Preserve
   the exact upstream revision, lock digest, Bun pin and pristine-input guards.
3. Set a separately recorded, explicitly local runtime version/channel in both
   the build environment and emitted candidate manifest. Do not represent a
   local question-form build as the released runtime or edit product trust pins.
4. Include the focused Promise question and form regression commands below in
   the copied recipe before compilation. Retain existing full source checks;
   do not silently expand the existing Intel macOS waiver.

This is a manual, separately reviewed candidate recipe, not a new preparer
utility or an active recipe switch. Building involves the copied recipe's
frozen-lockfile dependency installation and native compilation; perform it only
in the disposable build tree with the matching host target and record the
actual outcome. This copied-recipe build and installation have not been run.

The separate experimental local builder is not asserted to follow this copied
recipe or to pass its full canonical gate. Its compiled tests are a separate
evidence stream. Reusing scoped dependencies for a local experiment is
not a successful frozen-lockfile installation or full release build.

## Frozen-source and independent packaging evidence

On November 18, 2026, the final four-file source change was frozen. Parent
source-verification handoff reports:

- Core, plugin and TUI affected-package typechecks passed.
- Form tests: 40 passed, 255 assertions; neighboring tests: 61 passed.
- Nested-question follow-up: 220 repeated tests passed.
- Four-file Prettier and oxlint checks passed. Broader source lint reported
  1,309 warnings and zero errors, not a warning-free result.
- Both review findings were resolved and independently reviewed (handoff 8210).
- Canonical upstream root `bun run check` remains blocked by missing website
  Astro dependencies in the scoped dependency setup. It is not a full-check pass.

Independent packaging used the hardened external `source-provenance.mjs` API
with the explicitly reviewed 40-file untracked inventory. It captured 8,595
tracked/reviewed source files and modes, used a temporary index, and verified
that the real source index and frozen source snapshot remained unchanged.
The complete candidate was reconstructed on disk from pristine upstream and
matched the inventory byte-for-byte and mode-for-mode. Independent cached-index
application and reverse application of both v15 and v16 restored the pristine
upstream tree. The applied trees were:

- v15: `54c82b09674e75eaca8bf8535b9563e048b49cd7`.
- v16: `c67d50a38ff2bde0f55ea15c0ffb743147c8be0e`.

Their delta contains exactly:

- `packages/plugin/src/promise/adapter.ts`
- `packages/core/test/plugin/promise-tool.test.ts`
- `packages/tui/src/routes/session/form.tsx`
- `packages/tui/test/cli/tui/form.test.tsx`

All 40 reviewed untracked files have identical Git blob/mode entries in both
trees. No builder files or native source files were changed by packaging.
External evidence directory:
`/home/factory-droid/ctg-native-form-runtime-20261118/packaging-independent-SpKtOp/`.
It contains `provenance.json`, `source-files.json`, `source-inventory.json`,
`packaging-equivalence.json`, `packaging.log` and the exact `source.patch`.
These local evidence paths are not dependencies of the packaged tests.

Carthagent verification against these exact candidate bytes passed independently:

- Focused packaging and Ship-plan tests: 16 passed, zero failed/skipped.
  Log: `focused-packaging-tests.log` in the evidence directory above.
- Full `npm run quality`: exit 0; lint, build/syntax checks and both typecheck
  sets passed. Node tests: 1,189 total, 1,184 passed, zero failed, five skipped.
  Log: `carthagent-quality-truecolor.log` in that directory. The run used
  `TERM=xterm-256color COLORTERM=truecolor FORCE_COLOR=3` and the existing
  dependency symlink; no dependencies were installed.

This Carthagent quality result does not clear the separate upstream canonical
check blocker or establish compiled-runtime behavior.

## Verification to record

To reproduce the Carthagent checks, run in its checkout:

```bash
node --test tests/native-question-runtime-patch.test.mjs tests/native-ship-plan.test.mjs
TERM=xterm-256color COLORTERM=truecolor FORCE_COLOR=3 npm run quality
```

The new test has no network or external-checkout dependency. Missing candidate
bytes or a missing reviewed digest intentionally fail rather than skip. Its
checks cover immutable release inputs, complete patch paths and presence of the
new implementation/regressions; they do not execute the patched native source.

With the pinned dependencies available in the applied upstream candidate, run
the actual focused regressions from the corresponding package directories:

```bash
cd "$CANDIDATE/packages/core"
bun test --timeout 60000 test/plugin/promise-tool.test.ts test/tool-question.test.ts
cd "$CANDIDATE/packages/tui"
bun test --timeout 60000 test/cli/tui/form.test.tsx
```

Record command, exit code, counts and input hashes. Also run the copied recipe's
source checks/typechecks and record any omissions. The intended regressions
include missing/different setup locations, direct and nested get/list calls,
copied contexts, concurrent sessions, exact form ownership and cleanup; long
forms at 120×40, 90×28 and 70×22; page/wheel scrolling, reveal before activation,
text validation, custom multiselect/paste, external instructions, confirmation,
resize and growing editor visibility. Presence of those tests is not a pass.

For compiled-runtime verification, record executable/manifest hashes, exact
local version/channel, isolated profile/workspace paths, fixture/provider setup,
terminal dimensions, snapshots and observed submission/cancellation behavior.
Do not use the ordinary user profile or carry credentials into fixtures.

The external staging wrapper bypasses the product resolver and records
`productResolverAccepted: false`. Its observed local-version execution
is local candidate evidence only. It is not evidence that the
unchanged product resolver accepts v16, nor released or installed-product
acceptance. Do not relabel or modify that wrapper to disguise this distinction.

## Local compiled-runtime acceptance

The experimental Linux ARM64 runtime
`0.0.0-ctg.2.0.32-local.form.20261118` passed all 17 scenarios in the retained
initial acceptance batches: 10 API, six live-attached TUI approval/default-reject
cases at 120×40, 90×28 and 70×22, and one cross-workspace form-placement case.
The complete patch hash matches the candidate above. Executable SHA-256:
`42a06c54fdd4e25e608f7959364d57ec168c972ee585546fd528dd325ed0fc67`.
Archive SHA-256:
`4faa850c5a9efcd0905c391423f4806d2bd7267b076e6df257ea22858aa3828d`.

Each terminal attached before the nested question, with no reattachment or
navigation workaround. PageDown exposed exact old/new text, consequences and
choices. Enter retained default rejection; Down then Enter approved. Approval
reset prior evidence, progress and review. Premature finish remained blocked;
fresh checks and review restored verified state. Negative cases covered custom
and multiple answers, cancellation, interruption, headless rejection, and stale
proposals after progress, durable-report and new-prompt changes. Workspace B did
not display A's form, though A's answer-needed sidebar status remained visible.

These cases use a real, local requirement-replacement plugin candidate that is
not part of this source-only change. Compilation reused installed dependencies;
acceptance loaded the plugin checkout and monitored four product-file hashes,
not its full dependency closure. Source reconstruction is local provenance,
not a hermetic or reproducible-build claim. External native-test verifier trust
was explicit; product resolver acceptance and publication remain false.

An independent read-only audit confirmed artifact hashes, runner assertions,
actual key submissions, state transitions and terminal text snapshots. Fourteen
PNGs were retained but their pixels were not visually inspected. The worker
reported private services closed; retained cleanup observations are not an
exhaustive independent port/process audit. All eight retained launcher files
were independently checked for credential removal. Normal profiles were unused.

Local evidence under `/home/factory-droid/ctg-native-form-runtime-20261118/`:
`builds/candidate-xBH3my/`, `api-1794966071591/`, `tui-1794966071589/`,
`crossworkspace-1794966071595/` and `cleanup-check.json`.

| Gate | Status |
| --- | --- |
| Final source-provenance inventory and candidate hash | Recorded above |
| Independent apply/reverse/tree-equivalence check | Passed; exact four-file delta, 40 added files preserved |
| Focused native source tests and affected typechecks | Passed per frozen-source handoff above |
| Canonical upstream root check | Blocked by missing website Astro dependencies |
| Carthagent focused tests and root quality on final bytes | Passed; 16 focused, full suite 1,184 passed / 5 skipped / 0 failed |
| Exact compiled candidate and isolated TUI interaction | 17 local scenarios passed; experimental Linux ARM64 only |
| Product resolver acceptance of this candidate | Not accepted; no trust-pin change |
| Five-platform release and installed-product acceptance | Pending; outside this source-only change |
