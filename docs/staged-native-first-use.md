# Staged native first-use polish (source only)

This stages a complete candidate patch against pristine upstream. It does not
activate a runtime or change the released CLI. The active combined-v15 recipe,
release manifest, development-v20 pin and combined-v16 record remain unchanged.

## Changes

- Home offers concrete first-task examples, explains Ship versus Quick, and
  gives own-provider `/connect` guidance separately from Cloud `/login`.
- An empty model picker explains how to recover. Its existing Ctrl+A action
  opens the provider picker; unmatched searches in a populated catalog still
  say “No results found”. Embedded pickers retain their caller-owned behavior.
- Composer metadata uses its allocated row width, including the space lost to
  the sidebar and Send control. Model and provider have an explicit separator;
  narrow layouts can omit the provider instead of colliding with the model.

## Source identity

- Carthagent base: `83ef834264349e89d3c9605a38cb8c09160b86e4`.
- Pristine upstream: `843a6c514e606b436a7fe713422ace0a93ad3d61`.
- Bun: `1.4.2`; lock SHA-256:
  `9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d`.
- Candidate: `docs/patches/opencode-v2.0.32-session-ui-combined-v17.patch`.
- v16 tree: `c67d50a38ff2bde0f55ea15c0ffb743147c8be0e`.
- v17 tree: `d5f43072b0205500521b7aac05e8f01cbfc632d4`.
- Source inventory SHA-256:
  `1a386afbfadf4ba940d10f73b857a33d92f005e443c32c4f40e640f97f61d566`.

Candidate patch SHA-256: `e4fe6ee137d27fbc279c33e169725292e7bff1151a1fea2d8b23cb1f16664d57`.

<!-- reviewed-delta-paths -->
```json
[
  "packages/tui/src/component/dialog-model.tsx",
  "packages/tui/src/component/prompt/metadata.tsx",
  "packages/tui/src/routes/home.tsx",
  "packages/tui/test/cloud-onboarding.test.tsx",
  "packages/tui/test/command-selection.test.tsx",
  "packages/tui/test/feature-plugins/prompt-footer.test.tsx"
]
```

The complete patch reconstructed all 8,595 source files with matching bytes and
modes, leaving the source index unchanged. Separate cached indices applied v16
and v17 to pristine upstream and reversed each back to the pristine tree. Their
tree delta is exactly the six paths above. All 40 baseline added files remain;
39 have unchanged blobs/modes, while cloud-onboarding intentionally changes.
The previous v16 test's four-file comparison is preserved, not widened.

Evidence root: `/home/factory-droid/ctg-firstuse-runtime-20261118/`:
`final-source/` contains the complete patch and inventory;
`packaging-independent-hAAUnl/verification.json` records independent application.
These local paths are audit artifacts, not dependencies of checked-in tests.

## Validation

- Native `packages/tui`: `bun typecheck` passed.
- Six-file Prettier check and oxlint passed.
- Final post-format renderer run: 160 passed, zero failed across ten repetitions
  of the home, command-selection and prompt-footer suites. Sizes include
  120×36 and 80×24, catalog loading/empty/connected states, draft entry, picker
  focus, provider recovery, unmatched search, mode/model clicks and Send bounds.
- Initial combined run: 15 passed, one failed because the existing custom-command
  assertion expected the old separator-free label. Updating both expected labels
  produced 16/16, then 160/160; selection and request assertions remain intact.
- Six-file source review found no actionable regressions.
- Local Linux ARM64 compilation passed, runtime
  `0.0.0-ctg.2.0.32-local.home.20261118`, under `builds/candidate-zpeMpE/`.
  The build independently checked source identity before and after compilation.
- Carthagent `npm run quality` passed: lint, typechecks, syntax checks,
  1,191 tests passed, zero failed, five skipped. Packaging review found no findings.
- Compiled interactive clean-profile acceptance: 11 PASS, zero FAIL, two BLOCKED.
  The actual candidate and real plugin showed home guidance, draft/Send controls,
  empty model/search recovery and real integration choices at 120×36 and 80×24.
  Submitting without a model opened connection recovery; Escape preserved the
  full unsent draft across resizes. No provider authentication or inference ran.
  Native UI exited zero; its private service and PTY were stopped.
  Evidence: `acceptance-u0oRg5ic/` under the evidence root, 22 PNG/text pairs and
  a 164.93-second recording. Initial external wrapper failures are retained and
  distinguished from successful product observations in its report.
  Executable SHA-256:
  `fecb9630190291b6e60545a03df6262223faa53cf1efa5a89230efd608ff96c5`.
  Real plugin commit: `887c662a7694efd6943649babc2c4803ac8b899a`.
  Authenticated candidate rendering was not exercised to avoid modifying the
  existing evaluation profile; metadata has renderer-test evidence only.
  Pixel inspection is unavailable in this environment. These two blocked steps
  mean overall runtime acceptance remains incomplete despite functional passes.

This is a scoped-dependency local build with `--skip-install --skip-web-ui`,
not a frozen-lockfile reinstall or full release build. Canonical upstream root
checks are not claimed green: the preceding v16 run was blocked by missing
website Astro dependencies. Native package checks above cover this delta.

Experimental runtime acceptance uses a separately pinned external test manifest.
It does not establish product-resolver acceptance (`productResolverAccepted:
false`), shipped behavior, multi-platform acceptance or visual pixel sign-off.
No workflow dispatch, runtime promotion, release or deployment is included.
