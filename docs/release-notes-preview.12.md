# 1.1.0-preview.12 experimental release

Experimental preview. Install it explicitly with the experimental channel;
stable 1.0.7 is unchanged and published preview.11 remains immutable.

## What changes

**npm package keeps the `ctg` command.** Preview.11 declared its command as
`./bin/ctg.mjs`. npm 11 treats that path as invalid and removes it during
`npm publish`, so a registry copy of preview.11 would have installed without a
`ctg` command. Preview.11 was therefore published on GitHub only. Preview.12
declares `bin/ctg.mjs` and normalizes the repository URL, so `npm publish` makes
no corrections to the manifest.

**Release check.** `tools/verify-release-version.mjs` (run by the release
workflow before anything is uploaded) now runs `npm publish --dry-run` and
fails if npm would auto-correct or remove any field, if `bin.ctg` is not a
plain relative path, or if the packed package lacks an executable
`bin/ctg.mjs`.

Product behaviour, the Projects / Voyages left pane, the native runtime source,
and the CTG patch are identical to
[preview.11](release-notes-preview.11.md). The runtime is rebuilt only because
each runtime manifest is bound to its exact package version.

## Provenance

| Input | Exact value |
| --- | --- |
| Package | `1.1.0-preview.12` |
| Prebuild source | `PREBUILD_SOURCE` |
| Prebuild workflow run | [PREBUILD_RUN](https://github.com/B-icy/Carthagent/actions/runs/PREBUILD_RUN) |
| Full manifest SHA-256 | `MANIFEST_SHA` |
| Upstream revision | `843a6c514e606b436a7fe713422ace0a93ad3d61` |
| CTG patch (combined-v4) SHA-256 | `1f2309bb3a31dfb8e8a0827a6a1144a1f76a005abff58f6f48857639ec02478a` |
| Lock SHA-256 | `9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d` |
| Runtime / compatibility | `0.0.0-ctg.2.0.32` / `2.0.32` |

## Trying it

```sh
ctg update --channel experimental --check
ctg update --channel experimental
ctg --version   # 1.1.0-preview.12
```

Or install the exact version from npm or the exact tag:

```sh
npm install -g carthagent@1.1.0-preview.12
npm install -g --install-links=true github:B-icy/Carthagent#v1.1.0-preview.12
```

`ctg update --channel stable` returns to stable 1.0.7 without `--force`. See
the [upgrade guide](native-upgrade.md) for profile preservation.
