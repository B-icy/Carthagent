# Carthagent 1.1.0

The first stable release of the native Carthagent console. `npm install -g
carthagent` and `ctg update` on the stable channel now install 1.1.0; 1.0.7 was
the previous stable release.

## Upgrading from 1.0.7

1.1.0 replaces the 1.0.7 split-terminal console with the native console that
shipped in the 1.1.0 betas. Read this before updating.

- **Node:** 22.22.2+, 24.15+ or 26+ (1.0.7 accepted 22.19+). `ctg update`
  refuses to install on an older Node and tells you which version it needs.
- **Update:** `ctg update` (stable channel), or `npm install -g carthagent@1.1.0`.
  On first launch, Carthagent downloads its checksum-pinned runtime for your
  platform (about 65–75 MB) into `~/.carthagent/opencode/`. It never uses or
  changes a separate OpenCode installation.
- **Sign-in:** native settings, sessions and credentials live in a new profile.
  Run `ctg login`. To reuse your 1.0.7 Carthagent Cloud sign-in, choose
  Carthagent Cloud and accept **Import an existing stable Carthagent Cloud
  sign-in?**; the old credential file is read, not changed. Bring-your-own
  provider keys are set up again with `/connect` or `ctg login`.
- **Old sessions:** 1.0.7 sessions are kept as read-only archives. Use
  `ctg archive search|read|export` or `/archive`. They cannot be continued in
  the native console.
- **Going back:** `npm install -g carthagent@1.0.7` reinstalls the previous
  release. Neither direction deletes profiles or old transcripts.

See the [native upgrade guide](native-upgrade.md) for profile locations and
source-checkout updates.

## What's new since 1.0.7

- **Native console** with Projects, folder-first new sessions, session tabs,
  and Ship / Quick / Plan / Build modes. Ship keeps approval, checks, review,
  repair, recovery and resume.
- **Carthagent Cloud onboarding:** guided `ctg login`, `ctg account`,
  `ctg billing`, and Cloud models listed under **Carthagent Cloud** (shown as
  "Carthagent Ship" in 1.0.7).
- **Voyages and daily quests:** quests accept work from any mode; verified Ship
  deliveries earn rewards you claim with `/voyages claim`.
- **Headless runs:** `ctg -p` streams tool events in `--json`, infers the
  provider for `--model`, waits for Cloud models on a cold start, and declines
  permission prompts it cannot ask instead of hanging.

The per-beta notes ([beta.1](release-notes-beta.1.md) through
[beta.8](release-notes-beta.8.md)) have the details.

## Changes since 1.1.0-beta.8

- Slash autocomplete shows one row per command; duplicate `/resume` and
  `/review` rows are gone (runtime combined-v14).
- `ctg <command> --help` and `ctg help <command>` print usage without running
  the command; `/help` starts with a short "Start here" list.
- Clear messages for `ctg validate` with a missing or invalid file, `ctg status`
  in folders it cannot fingerprint, and `ctg billing portal` before a first
  purchase.
- Credit figures match the website (balances round down, spend rounds up).
- Signed-in device names include host, OS and a short install ID.
- Review works in a repository with no commits.
- Read-only questions in Ship are answered directly instead of running the full
  delivery workflow.
- Managed Cloud requests dropped before any response are retried once.
- Quick, Plan and Build no longer see Ship-only tools.
- New Voyages catalogue items and art.

## Verification

- Five-platform runtime prebuild
  [42911561293](https://github.com/B-icy/Carthagent/actions/runs/42911561293)
  from source `f98203639e6a5953d3ee77b3d386a802cc80312d` passed every platform
  gate (Windows x64, Linux x64/ARM64, macOS x64/ARM64). The candidate manifest
  was regenerated independently from the downloaded archives and matched byte
  for byte; all five archives passed the production acquisition verifier.
- A clean 1.0.7 npm install updated itself to the 1.1 line through
  `ctg update`, the path stable users take.
- Repository suite, cross-platform CI and the installed-package gate run again
  on the exact release tag before publication.

## Known limitations

- **Intel macOS:** the context-menu Rename after resize/reopen test remains
  excluded from Intel macOS release gates (accepted for beta.8); a separate
  30-repeat diagnostic passed on that platform.
- Long navigation stress runs have hit plugin-readiness timeouts.
- npm prints an `EBADENGINE` warning for `@opentui/core` (it declares Node
  26.4+ or Bun). Carthagent runs on the supported Node versions above; the
  warning is harmless.
- Daily-quest evidence you enter is assessed as a claim, not independently
  verified, and does not earn coins or XP by itself.

## Runtime provenance

Upstream `https://github.com/anomalyco/opencode` at
`843a6c514e606b436a7fe713422ace0a93ad3d61` (compatibility 2.0.32) with
`docs/patches/opencode-v2.0.32-session-ui-combined-v14.patch`
(SHA-256 `6ff3b4112fce21104bcd09c22549b04e29b9bd52c4713600687d2cdf21558d02`).
`lib/opencode/runtime-release.json` pins each archive and executable digest;
the release assets include that manifest and combined checksums.
