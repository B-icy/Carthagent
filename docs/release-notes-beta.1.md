# Carthagent 1.1.0-beta.1

The first 1.1 beta brings the native Projects, Ship, Voyages and daily-quest experience from preview.13 together with fixes verified through real DeepSeek work and account transactions.

## Fixed

- **Ship reviews for nested apps:** capture the application's own tracked and new source even when its Git root is an ancestor directory. Workspace containment, excluded directories, symlink protection and snapshot freshness remain enforced.
- **Clear implementation-tool guidance:** Ship explains when planning unlocks direct write/edit/shell tools, the extra strict-workflow prerequisites, and how direct tools differ from code-mode discovery.
- **Long-running headless tasks:** reconnect the wait observer after an HTTP header timeout without resending an admitted task.
- **Useful shop errors:** unaffordable items show `insufficient_coins`; invalid and expired quotes have distinct errors.
- **Quest evidence preview:** use **Ctrl+G** instead of the command palette's Ctrl+P. Incomplete evidence is rejected locally before submission.

## Verified-delivery rewards

From a completed Ship session, open Voyages and choose **Claim verified delivery
reward**. An eligible current required-check handoff earns **25 coins, 100 XP
and 1 km**, at most **three per UTC day**. Preview and confirmation are explicit;
duplicate run/project-snapshot claims cannot earn twice. Only digests are sent,
not source code or check output. The backend trusts the authenticated local
harness attestation; it does not independently rerun the repository.

The matching backend is deployed. Live earned claim, exact replay and native
service restart passed on the owner's account: 20 → 45 coins, 0 → 100 XP and
0 → 1 km, preserving equipment. See [reward acceptance results](beta-rewards-e2e-results.md).

## Verified in real use

- DeepSeek completed an accepted, snapshot-bound Ship delivery repairing Invest-With-Friends' existing build/type/lint failures. Independent checks confirmed **32 passing tests**, clean typecheck, lint with **0 errors / 13 existing warnings**, and a successful production build.
- Production HTTP checks rejected **25 invalid trade payloads**.
- A real 30-coin equipment purchase debited once, and ownership/equipment persisted through restart. Duplicate purchases, unowned equipment, locked items, stale profile writes and insufficient funds were rejected.
- Three distinct daily outcomes completed grading; one was assessed complete and two needed more evidence. Cross-quest duplicate claims were rejected. Ctrl+G validation and draft cancellation were checked in the live TUI.

## Beta scope and known limitations

- Daily quests assess selected evidence; they are not independent verification. **Daily-assessment rewards are disabled:** no coins, XP, distance or equipment are granted for assessment alone. Verified-delivery claims are a separate path.
- Native friends/badges views are not implemented.
- Long quest summaries can overlap the actions heading in the terminal.
- The Invest-With-Friends delivery is a verification example, not a deployment of that application. Its full authenticated Google/database/trading flows remain unverified; its production environment needs an auth secret, and its existing trade endpoint checks market status before authentication.

See [the launch-readiness report](launch-readiness-live-results.md) for detailed results and limitations.

## Install or upgrade

```sh
ctg update --channel beta --check
ctg update --channel beta
ctg --version # 1.1.0-beta.1
```

Or install the exact npm version:

```sh
npm install -g carthagent@1.1.0-beta.1
```

This is a GitHub prerelease, published to npm's `next` tag. Stable `latest` remains 1.0.7. The beta channel deliberately selects this beta even though SemVer orders the older `preview.13` label above `beta.1`; an explicit channel switch is supported. `ctg update --channel stable` returns to stable.

## Runtime provenance

Five native runtime builds are produced by [prebuild run 41398315323](https://github.com/B-icy/Carthagent/actions/runs/41398315323), from source `7a027f0aa792d40802acc92e7d12630b510df241`. The runtime recipe remains combined-v5 on upstream `843a6c514e606b436a7fe713422ace0a93ad3d61`, compatibility `2.0.32`. The packaged `lib/opencode/runtime-release.json` pins the beta's archive and executable digests; release assets include that manifest and combined checksums.
