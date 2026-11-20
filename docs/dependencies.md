# Dependencies

Two gates keep the dependency manifests honest:

- `npx knip --include dependencies,unlisted,binaries,unresolved` finds
  declared packages that nothing imports, and imported packages that no
  manifest declares. Configuration: [`knip.json`](../knip.json).
- `node tools/check-dependency-drift.mjs` (add `--json` for machine output)
  finds version drift between the root package and the
  `plugins/carthagent` workspace.

Both read only local files, need no network, and exit non-zero on a finding.

## Unused and unlisted dependencies (knip)

`knip.json` treats every first-party source file as an entry point, because
much of this repository is loaded by path rather than through imports:
`bin/`, `lib/`, `extensions/*.ts` (loaded by jiti), `tools/`, `tests/`,
`evaluate.mjs`, and every file under `plugins/carthagent` (loaded by the
native runtime). `vendor/` is ignored: it is a committed bundle whose own
imports are not ours to declare. With every file as an entry, only the
dependency report is meaningful, so run knip with the `--include` list above.
Unused files and exports are out of scope for this gate.

A cold run takes about 13 s on one CPU. Add
`--cache --cache-location node_modules/.cache/knip` to bring a warm run down
to about 8 s.

### Configured exceptions

Each entry below is real usage that knip cannot see. Add an exception only
with a reason here.

| Setting | Name | Why knip cannot see the use |
| --- | --- | --- |
| root `ignoreDependencies` | `@resvg/resvg-js` | Imported by `plugins/carthagent/src/ui/voyages-preview.tsx`. npm does not install a nested workspace's dependencies for users of the published `carthagent` package, so the root must declare it. `tools/test-native-package.mjs` checks this. |
| root `ignoreDependencies` | `tree-sitter-wasms`, `web-tree-sitter-legacy` | `lib/codegraph.mjs` loads them through a `createRequire` instance named `require_`. knip does not track that. |
| root `ignoreDependencies` | `@earendil-works/pi-coding-agent` | A module name, not a package. `extensions/*.ts` import it, and jiti resolves it to `vendor/agent/index.js` through an alias. Its types are in `types/pi-coding-agent.d.ts`. |
| `ignoreBinaries` | `cygpath`, `where.exe`, `taskkill.exe`, `openssl`, `geckodriver` | Operating-system or externally installed programs, invoked only on the platforms or in the benchmarks that need them. |

### Findings that need a manifest change

These are real findings. Fixing them needs `package.json` changes, which the
maintainers make:

- `@opencode/schema` is imported at runtime by `lib/opencode/credentials.mjs`
  and by `plugins/carthagent/src/server/{providers,device-auth}.ts`. Both
  also import its types. Neither manifest declares it. It resolves today only
  because npm hoists it as a dependency of `@opencode/plugin`. Declare
  `"@opencode/schema": "2.0.32"` in `dependencies` of both `package.json` and
  `plugins/carthagent/package.json`. It is already in the lockfile at that
  version.
- `jscpd` is a devDependency that no script runs. Either a script that runs it
  (for example `"duplicates": "jscpd"` with `.jscpd.json`) or its removal
  clears the finding.

## Version drift (tools/check-dependency-drift.mjs)

The tool fails when any of these is true:

1. A dependency is declared with different ranges, either across workspaces or
   across `dependencies`, `devDependencies`, `peerDependencies` and
   `optionalDependencies` of one workspace. A root `overrides` entry for a
   declared dependency must use the same range.
2. `package-lock.json` resolves a dependency shared by several workspaces to
   more than one version (for example a nested
   `plugins/carthagent/node_modules/<name>` copy).
3. An exact-version root `overrides` entry is not honored everywhere in the
   lockfile.
4. A declared `@opencode/*` package is not exactly the `compatibilityVersion`
   in `lib/opencode/runtime-release.json`. A declared `@opentui/*` package is
   not exactly the version that those locked `@opencode/*` packages require
   (currently `@opencode/theme@2.0.32` requires `@opentui/core@0.5.17`).

To bump the runtime pin, change `runtime-release.json`, every `@opencode/*`
and `@opentui/*` range in both manifests, and the lockfile together. Then run
the tool.
