# 1.1.0-preview.13 experimental release

Experimental preview. Install it explicitly with the experimental channel;
stable 1.0.7 is unchanged and published preview.12 remains immutable.

## What changes

**Directory-first Projects rail.** The native left rail is organized around
folders: a current-folder card with Browse, New session and model controls,
distinct folder and group headings, and an active-session marker. A
folder-browser dialog adds Back, Forward, Up, Home, direct paths and
filtering, with async cancellation, exact path handling and preserved drafts.

**Shared folder/model setup for new sessions.** Global and per-folder New
session entries route through one setup flow. The session is created only on
the first send, keeping the chosen folder, agent, model and applicable
variant; unavailable selections are blocked instead of silently substituted.
Pre-session `/model` is supported.

**Isolated source-preview launcher.** `script/ctg/source-preview.sh` runs the
checked-in development patch against its own profile for verification without
touching the published runtime or its caches. The combined-v5 patch is a
replacement patch: it contains all of combined-v4 plus these sources and
their tests, and applies directly to the pinned upstream.

The upstream revision, lockfile and detached runtime identity are unchanged
from preview.12; the runtime is rebuilt because each runtime manifest is
bound to its exact package version.

## Provenance

| Input | Exact value |
| --- | --- |
| Package | `1.1.0-preview.13` |
| Prebuild source | `PREBUILD_SOURCE` |
| Prebuild workflow run | [PREBUILD_RUN](https://github.com/B-icy/Carthagent/actions/runs/PREBUILD_RUN) |
| Full manifest SHA-256 | `MANIFEST_SHA` |
| Upstream revision | `843a6c514e606b436a7fe713422ace0a93ad3d61` |
| CTG patch (combined-v5) SHA-256 | `8716b5f686fa733245f63e8036cc503bc628e16b79cd508b13925da4020738c6` |
| Lock SHA-256 | `9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d` |
| Runtime / compatibility | `0.0.0-ctg.2.0.32` / `2.0.32` |

## Trying it

```sh
ctg update --channel experimental --check
ctg update --channel experimental
ctg --version   # 1.1.0-preview.13
```

Or install the exact version from npm or the exact tag:

```sh
npm install -g carthagent@1.1.0-preview.13
npm install -g --install-links=true github:B-icy/Carthagent#v1.1.0-preview.13
```

`ctg update --channel stable` returns to stable 1.0.7 without `--force`. See
the [upgrade guide](native-upgrade.md) for profile preservation.
