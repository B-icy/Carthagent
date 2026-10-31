# Native OpenCode manual-test candidate

This is the **unpublished 1.1.0-preview.9 release candidate**, not a stable 1.1.0
release or an available GitHub prerelease. The experimental updater selects
published releases only; it cannot install this candidate yet. Use the explicit
reviewed-artifact path below. The regular OpenCode installation is never replaced.
Native remains the default, inherited from preview.8 (`ctg native` remains an alias). The fixture runner
below uses a separately verified owned binary and isolated profiles. Agent/tool execution is **not an OS
sandbox**. Start with these disposable projects.

## 1. Get the candidate source

For current candidate work, use the reviewed `release/preview-9-candidate`
checkout and record its exact commit and dirty state. The prebuild source is
`c51c5ae11293e63b658df297abc732db88d9109a`; final package/manifest and documentation
changes are separate from that prebuild source. See the
[candidate notes](release-notes-preview.9.md).

The following exact-tag clone is **for future use only, after publication**.
After publication, `ctg update --channel experimental` can select the published
preview; it does not select a branch or prebuild. Launch with `ctg`.

```sh
git -c core.autocrlf=false clone -c core.autocrlf=false --branch v1.1.0-preview.9 https://github.com/B-icy/Carthagent.git ctg-native-manual
cd ctg-native-manual
npm ci
```

The clone-local line-ending setting preserves hash-pinned patch bytes on Windows;
it does not change global Git configuration. Node 24.21 and Git were used here;
the package minimum is Node 22.19.0. Node 24 may print an engine warning for
`@opentui/core`'s Node >=26.4 declaration. This candidate's renderer runs in the
bundled Bun-based executable, not Node; local Node 24 results are recorded
separately from that warning. Python 3 is needed only for automated POSIX PTY
probes, not for the interactive manual runner. No Bun installation is required.

## 2. Prepare your machine's runtime and projects

Run this helper from the source checkout, which includes `package-lock.json`, not
from the global npm installation. By default it acquires the current platform's
archive from the exact published release in the packaged trust manifest. GitHub
CLI authentication is not required for published assets. Setup fails rather than
silently selecting an upstream/system binary.

```sh
node tools/prepare-native-manual.mjs ../ctg-manual-kit
```

That default command requires published assets. For preview.9 before publication,
use the explicit candidate manifest and archive command below instead.

Supported targets: Linux x64/arm64, macOS x64/arm64, Windows x64. Use matching Node
architecture; native Windows arm64 is not in the reviewed candidate. WSL is Linux,
not proof of Windows terminal behavior. The commands also work in PowerShell.

For offline archive acquisition, obtain the matching release archive first, then use:

```sh
node tools/prepare-native-manual.mjs ../ctg-manual-kit --assets /path/to/unzipped-artifact
```

For an unpublished prebuild, obtain the matching artifact and its complete candidate
manifest from the reviewed build. Supply an independently checked manifest digest:

```sh
node tools/prepare-native-manual.mjs ../ctg-candidate-kit --assets /path/to/archives --manifest /path/to/runtime-release.json.candidate --manifest-sha256 aa5de65b633219423d21b1cc645945028a2d5565714b71760cbcc18badc5f4e5
node tools/native-manual.mjs ../ctg-candidate-kit tiny --manifest /path/to/runtime-release.json.candidate --manifest-sha256 aa5de65b633219423d21b1cc645945028a2d5565714b71760cbcc18badc5f4e5
```

These pins identify prebuild run `40151970983` for preview.9. Its original
13-file bundle was independently verified through the production acquirer, and
manifest regeneration was byte-identical. The new Linux ARM64 bytes passed
isolated staged native-host and Ship-model probes; other platforms' execution
remains unverified here. Setup above executes a verified `--version`;
neither that nor archive verification substitutes for full installed acceptance.
Use the same `--manifest` and `--manifest-sha256` on **every** candidate-kit
invocation below (including `--smoke`, `--live`, and `--stop`), and replace
`../ctg-manual-kit` with `../ctg-candidate-kit`. Retain `--assets` and both manifest
arguments when preparing a larger unpublished kit too.

Do not derive the expected digest from an untrusted download without reviewing it.
The helper prints the same manifest arguments to use with `native-manual.mjs`.
Existing published manifests and per-platform archive hashes are never rewritten
to make a different candidate pass.

The directory must contain `opencode-<target>.tar.gz`, **not** an arbitrary
executable. Setup uses the production archive verifier, checks the packaged trust
root, source/patch/lock and archive/executable SHA-256 pins, and executes a checked
`--version`. It refuses an existing destination. No global install, normal
OpenCode profile, shell startup file, or system configuration is modified.

The kit contains three independent Git repositories and a file/hash inventory:

| Project | Purpose | Before implementation |
| --- | --- | --- |
| `tiny` | Invoice discount in integer cents; validation and immutable input | 2 baseline tests pass; feature acceptance intentionally fails |
| `product` | Forgeboard: real HTTP server, board UI, filtering, optimistic-concurrency update task | HTTP/UI baseline passes; PATCH acceptance intentionally fails |
| `scale` | 128 domains, over 1,400 files, shared rounding bug, cross-package imports | 128 integration tests pass; rounding acceptance intentionally fails |

For a larger navigation/coverage stress project, prepare a **different** kit:

```sh
node tools/prepare-native-manual.mjs ../ctg-large-kit --packages 1024
```

This generates over 11,200 tracked files and 1,024 domain tests. It is synthetic,
not a claim about performance on a large commercial application. It deliberately
exceeds the usual 8,000-file navigation cap: coverage must report limits honestly.
No fixture needs `npm install`, a database, browser driver, cloud account, or secret.

## 3. Start with the provider-free UI

Run from the candidate source directory:

```sh
node tools/native-manual.mjs ../ctg-manual-kit tiny
node tools/native-manual.mjs ../ctg-manual-kit product
node tools/native-manual.mjs ../ctg-manual-kit scale
```

Each launch creates a disposable project copy and profile, starts the real owned
server/plugin plus a loopback-only **scripted** provider, and attaches the real TUI.
Provider/API/GitHub keys are not forwarded. Responses are fixtures, not reasoning;
do not use this mode to evaluate model quality or automatic implementation.
The copy/profile is removed on normal exit. The original kit projects stay clean.

Type `CTG_MANUAL_INSPECT` to exercise a real native tool call: the fixture authors
a baseline delivery plan, runs the project's actual Node tests through the native
shell, and returns `CTG_MANUAL_INSPECTION_COMPLETE` plus
`CTG_MANUAL_BASELINE_EXIT=0`. The plan unlocks the tool through production policy;
it does not disable the delivery gates or claim verified delivery/review.

The same path can be checked without an interactive terminal:

```sh
node tools/native-manual.mjs ../ctg-manual-kit tiny --smoke
node tools/native-manual.mjs ../ctg-manual-kit product --smoke
node tools/native-manual.mjs ../ctg-manual-kit scale --smoke
```

Smoke reports are under `<kit>/reports/`. A failed baseline, changed runtime,
wrong platform, or rejected delivery plan fails the command.

## 4. Manual terminal checklist

Use your real terminal and font, recording OS, terminal/version, Node architecture,
kit manifest hash, and executable SHA-256 from `manual-kit.json`.

- [ ] Normal startup; no Pi fallback; `ctg-fixture/fixture` selected offline.
- [ ] Type, paste multiline text, edit, cancel, and send exactly once. Include
  `café Ελληνικά 日本語 🧪` and literal `<script>alert("x")</script>`.
- [ ] Resize wide/narrow while typing and while a dialog is open. No lost text,
  stale screen, duplicate prompt, or terminal-title leak after exit.
- [ ] `/help` and `/ctg-help` show CTG commands, not a provider prompt.
- [ ] `/theme carthage` and another theme; reopen and verify colors/settings.
- [ ] `/model` cancellation leaves the selected model unchanged. Do not select
  external providers in offline mode. Test live model variants only when supported.
- [ ] `/autocompact off`, repeated `off`, `on`, and bare toggle; another session
  remains independent. `/compact` remains a separate manual operation.
- [ ] Send a marker, `/clear`, then ask another question. Visible transcript is
  cleared, not deleted. Reopen the same session and check durable history.
- [ ] `/copy`, drag selection, and paste into a local editor: exact text, no
  truncated Unicode or escape sequences. Physical clipboard is a manual gate.
- [ ] `/export manual-session.html` produces escaped HTML in the disposable
  project. Copy it out yourself before exit if you want to retain it; never
  export a real credential-bearing conversation into a shared directory.
- [ ] `/workflow`, `/architecture`, `/evidence`, `/ctg-workspace`; actual unknown,
  incomplete, or empty evidence must remain honest, not invented green receipts.
- [ ] Use native back/session navigation to leave custom workspace routes; they
  are not a replacement composer. Test independent sessions and worktree tasks.
- [ ] Close with the normal native quit action, then verify title/input restoration.
  Abruptly killing the wrapper is not a cleanup test.

### Known issues to observe, not waive

- Actual-slash acceptance is **partial**: `/stats` may select native host stats
  instead of CTG's handler; bare `/guide` does not reliably toggle framing on the
  tested completion path. `/guide <task>` and `/raw <prompt>` work in the recorded
  test. Use explicit `--no-guide` for live launch when you need framing disabled.
- Full physical clipboard, terminal-title readback, long-duration memory, and
  controlled paired performance acceptance remain manual/release gates.
- Linux automated success does not establish macOS/Windows native UI acceptance.
- GitHub draft/public release installation is not tested by this development
  override. Use the reviewed preview.9 prebuild assets and manifest together;
  do not substitute preview.8 assets or the unshipped v1.1.0 stable tag. Final-tag
  draft and anonymous-public default-resolver acceptance are still pending.
- Actual 60x12 terminal navigation was functional in development-runtime tests;
  that is not model-based visual approval or full cross-OS UI acceptance.

## 5. Explicit live-provider testing

Only this mode can use real provider credentials and incur charges. It operates
on the kit's persistent project, so inspect diffs afterward. The profile is
`<kit>/profiles/live`, not your existing CTG/OpenCode profile. Supported environment
keys forwarded intentionally are OPENAI_API_KEY, ANTHROPIC_API_KEY,
OPENROUTER_API_KEY, and GEMINI_API_KEY. Otherwise log in explicitly in this profile:

```sh
node tools/native-manual.mjs ../ctg-manual-kit tiny --live -- login
node tools/native-manual.mjs ../ctg-manual-kit tiny --live -- --max-tools 40 --max-seconds 300 --review no "Read TASK.md, implement the task, run both test suites, and report limitations. Do not push or create a PR."
```

Choose a provider/model explicitly if needed by appending `--provider` and `--model`.
These are tool/time limits, **not a monetary cap**. Set a provider-side spending
limit before running. The scripted fixture is not paid-provider evidence. The
live Voyages development-runtime observations in the candidate notes are account
and equipment tests, not a paid-model benchmark or proof of paid purchases.

Repeat on `product`, then `scale`, increasing limits only deliberately. For strict
workflow use `--workflow strict`. Do not treat a deterministic offline fixture's
review verdict as independent model review. PR review/push/merge and billing
operations are not needed for these tests.

In another terminal, verify the actual workspace independently:

```sh
cd ../ctg-manual-kit/projects/product
npm test
npm run test:acceptance
npm start
# Open http://127.0.0.1:3017; test keyboard controls, validation, and competing updates.
git diff --check
git diff
```

Use a second checkout/copy for an independent task rather than editing your own
production repo. Reopen persistent live sessions to test restart/history. Stop
only this kit's service when finished:

```sh
node tools/native-manual.mjs ../ctg-manual-kit tiny --live --stop
```

Keep the live profile private: it may now contain credentials and personal
conversation data. **Do not upload, bundle, serve, or commit the kit directory.**
For a fresh fixture create a new kit rather than resetting a directory containing
work you might want. Uninstall is simply stopping its service and removing the
candidate checkout and test kit after saving wanted work; no global binary changed.

## 6. Reproduce automated diagnostics

POSIX example (adjust paths; do not export these persistently):

```sh
export CTG_OWNED_OPENCODE_RUNTIME="$(pwd)/../ctg-candidate-kit/runtimes/1.1.0-preview.9/linux-x64"
export CTG_TEST_RUNTIME_RELEASE_MANIFEST="/path/to/runtime-release.json.candidate"
node tools/test-native-swe-host.mjs
node tools/test-native-public-repo.mjs
node tools/test-native-delivery-host.mjs
node tools/test-native-slash-commands.mjs
```

The public-repo diagnostic downloads a pinned `is-number` checkout and dev
packages, but uses an offline provider. Slash acceptance currently returns 2 for
its known partial result; keep the JSON proof instead of marking it passed.
For `test-native-pty.mjs`, use `CTG_TEST_RUNTIME_ARTIFACT_ROOT` instead of
`CTG_OWNED_OPENCODE_RUNTIME` (unset the latter); this is the stricter PTY trust
contract. Test default release acquisition separately only after publication.

Share sanitized observations: exact command, expected/actual result, terminal and
platform, source commit, runtime hash, and minimal reproduction. Do not attach
profiles, auth files, raw environments, or private-session exports.

## 7. Checked-in development runtime provenance

An explicitly selected owned root (`CTG_OWNED_OPENCODE_RUNTIME` or the internal
`ownedRuntime` option) may use either the published runtime patch provenance or
the checked-in development patch provenance. Both paths still require the
pinned Carthagent owner, upstream source repository/revision, lock digest,
compatibility/runtime versions, channel, host platform, disabled web UI, exact
`cli-<platform>/bin/opencode[.exe]` layout, matching executable `SHA256SUMS`
entry and actual bytes, and exact owned `--version` output. An adjacent
`runtime-release.json` cannot authorize a different source, lock, or patch.
The explicit root is a development selector: its local checksum detects byte
changes but does not independently establish a published binary's provenance.

The update point for a reviewed local patch is
`CTG_DEVELOPMENT_RUNTIME_PATCH_SHA256` in `lib/opencode/runtime.mjs`. It pins
the development patch `docs/patches/opencode-v2.0.32-session-ui-combined-v5.patch`
(SHA-256 `4059a8d81f26f18114898a77afc2fc6c1621fa616624a04884d5471a3904d2a3`),
a replacement patch containing the published combined-v4 changes plus the
folder-browser controller, the Browse folders dialog with its sidebar, compact
rail and command-palette entry points, the directory-first Projects rail (current
folder card with Browse, New session and model controls, distinct folder and
group headings, and an active-session marker), and their tests. It applies directly to a clean
checkout of upstream `843a6c514e606b436a7fe713422ace0a93ad3d61`; do not apply
it on top of v4:

```sh
git clone https://github.com/anomalyco/opencode.git opencode-dev
git -C opencode-dev checkout 843a6c514e606b436a7fe713422ace0a93ad3d61
script/ctg/prepare-development-runtime.sh opencode-dev
```

The preparation recipe checks the source revision, a clean checkout, and the
patch hash, then applies the patch. It does not install, compile, or publish.
After generating and reviewing new patch bytes, update **only this development
constant** and the preparation recipe's `EXPECTED_PATCH`. The regression test
in `tests/native-ship-plan.test.mjs` requires both to match the checked-in
development patch, and that the shared release recipe
`script/ctg/build-owned-runtime.sh` still pins the published v4 patch.
Do not change `CTG_RUNTIME_PATCH_SHA256`, the published
`lib/opencode/runtime-release.json`, its archive/executable pins, or historical
release documentation to make a development build pass. Promotion to a public
release requires its separate release-verification process.

The default manual-kit manifest is validated against the same immutable
published pins, not the advancing development recipe. Explicit manual-kit
candidate manifests must match the current recipe as well as their independently
supplied manifest digest. This keeps existing published kits usable without
allowing candidate provenance through the published path.

The normal public resolver continues to acquire and verify the published
release pins only. It will not accept development patch provenance or changed
executable bytes, even when the cache's adjacent manifest/checksums agree.
`CTG_OPENCODE_BIN` / the `binary` option retain their separate
upstream-compatible behavior and are not owned development provenance selectors.

Native development tests need an **independently reviewed test manifest** via
`CTG_TEST_RUNTIME_RELEASE_MANIFEST`. Its source/lock/patch/version/platform and
asset executable digest must describe the selected development artifact, not
the unchanged published artifact. `preflightNativeTestRuntimeArtifact` checks
that test record against provenance and actual bytes before executing
`--version`. `CTG_TEST_RUNTIME_SHA256` can explicitly override only the expected
test executable digest; it cannot override patch/source/lock/version checks.
Keep the test manifest separate from the released manifest; do not derive trust
solely from an artifact's self-declared `ctg-runtime.json`.

For PTY tests, keep using `CTG_TEST_RUNTIME_ARTIFACT_ROOT` plus the trusted test
manifest as described above, not the developer selector. A passing explicit
development-root test is **not** installed-default/public-release acceptance;
run that acceptance separately with all developer/test selectors unset against
the immutable released artifacts.
