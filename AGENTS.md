# Working on Carthagent

This repository contains the public `ctg` CLI and its native Carthagent plugin.
The website, Cloud service, and hosted Voyages backend live in the separate
`Carthagent-Backend` repository. Do not change that repository as part of CLI work.

## Setup and layout

- Use Node.js matching `package.json` engines: `^22.22.2 || ^24.15.0 || >=26.0.0`.
- Install the locked dependencies with `npm ci` in a fresh checkout. Avoid
  reinstalling an existing dependency tree unless required by a dependency change.
- `bin/ctg.mjs` is the CLI entry point. `lib/opencode/` owns native CLI routing,
  runtime provisioning, and profile integration; `lib/` also contains the shared
  delivery, review, planning, and browser modules.
- `plugins/carthagent/src/` contains the native TypeScript/TSX plugin. `extensions/`
  contains legacy extensions, not the default terminal renderer.
- `tests/` contains Node and Python regressions. `tools/` contains validators and
  integration probes. `docs/` documents feature contracts and acceptance limits.
- `vendor/` and `docs/patches/` hold pinned runtime inputs. Read
  `docs/opencode-owned-runtime.md` before changing runtime pins, patches, or builds.

## Development and verification

Read the relevant feature documentation before editing. Use focused tests while
iterating, then run the repository gate from the checkout root:

```sh
npm run check
node --test tests/<area>.test.mjs
npm run quality
```

`quality` runs ESLint and Prettier (`lint`), the syntax and TypeScript checks
(`build`), and the Node test suite. TypeScript and ESLint results are cached in
`node_modules/.cache/ctg/`. It does not include every integration suite. Run the
gates that cover the area changed:

- Python: `npm run test:python` (Python 3.11 and Pillow 11.3.0 in CI).
- Browser tools: `npm run test:browser`; keep generated evidence in `artifacts/`.
- Native runtime/plugin integration: `npm run test:native-host` and the relevant
  `test:native-*` scripts in `package.json`.
- Native TUI navigation: `npm run test:native-navigation` (Bun 1.4.2 in CI).
- Installed-package/runtime changes: `npm run test:native-package`.
- Offline CLI smoke: `node bin/ctg.mjs demo`; this is fixture evidence only.
- Credential-free QA of the dashboard, CLI and TUI: `npm run qa:smoke`; see
  `docs/interactive-qa.md`.

Other useful commands:

- `npm run format` rewrites files with Prettier; `npm run format:check` only checks.
- `npm run test:list` lists test names without running them (`node --test` has no
  list mode). `npm run test:coverage` fails below 78% lines, 77% branches and 83%
  functions for first-party code and writes JUnit/lcov to `artifacts/test-results/`;
  `npm run test:report` summarizes timings against `tools/test-budget.json`.
- `npm run check:repo` runs the repository policy checks: file sizes, debt markers,
  duplication (jscpd), unused dependencies (knip), version drift, feature-flag
  lifecycle, generated API docs and this file's validator.
- HTTP APIs are specified in `docs/api/*.openapi.json`. After changing routes in
  `server.mjs` or `lib/cloud/http.mjs`, update the spec and run `npm run docs:api`;
  `tests/openapi-contract.test.mjs` fails on undocumented or removed routes.
- Feature flags live in `lib/feature-flags.mjs`; see `docs/feature-flags.md`.
- Optional git hooks (pre-commit formatting, lint, size and debt checks on staged
  files): `npm run hooks:install`.
- Validate this file: `npm run agents:check`.
See `docs/quality.md` and `.github/workflows/ci.yml` for scope and CI platforms.
UI changes need a real render and screenshot; TUI changes need an interactive
terminal check and retained capture. Do not describe captures as visual approval
unless someone actually inspected them. Report exact commands, failures, skipped
checks, and environmental blockers rather than claiming unrun gates passed.

## Code conventions

These are enforced by Prettier (`.prettierrc.json`) and ESLint (`eslint.config.mjs`);
pre-existing violations are recorded in `eslint-suppressions.json` and must not grow.

- Formatting: Prettier, print width 160, semicolons, trailing commas. Single quotes
  and `x =>` arrows everywhere except the native plugin UI (`plugins/carthagent/src/ui/`,
  `src/tui.tsx`, plugin tests), which uses double quotes and `(x) =>`. Run `npm run format`.
- Naming: `camelCase` for functions, variables and parameters; `PascalCase` for classes,
  TypeScript types/interfaces and Solid components; `UPPER_SNAKE_CASE` for module-level
  constants; kebab-case file names (`delivery-review.mjs`, `*.test.mjs` in `tests/`).
  A leading underscore marks an intentionally unused binding. Keep external wire names
  (HTTP headers, JSON fields such as `access_token`) as the protocol defines them.
- Size and complexity: functions stay at cyclomatic complexity 15 or lower, nesting
  depth 4 or lower and at most 6 parameters; source files stay under 500 code lines
  (1000 for tests). Split modules instead of suppressing new violations. If you fix a
  suppressed violation, run `npm run lint:prune-suppressions`.
- Modules: ESM only, `node:` prefixes for built-ins. Respect the layer boundaries in
  `docs/architecture-boundaries.md` (enforced by `tests/architecture.test.mjs`).
- Debt markers: `TODO`/`FIXME` must reference an issue, e.g. `TODO(#123)`; see
  `docs/tech-debt.md`.
- Logging: use `lib/logger.mjs` (structured, redacts secrets, never writes to
  stdout); see `docs/observability.md`.

## Change boundaries

- Check `git status` first. Preserve existing and untracked work; do not reset,
  stash, clean, or overwrite another person's changes.
- Match the surrounding ESM/TypeScript style. Keep changes scoped and add
  regressions for behavior fixes. Never weaken validators to make a gate pass.
- Keep provider keys, tokens, real user data, and profile credentials out of
  source, logs, fixtures, and responses. Native profiles belong under
  `~/.carthagent/opencode/` (or `CTG_OPENCODE_HOME`); never copy credentials from
  another coding tool's profile.
- Do not make live paid model calls without an explicit spending budget. See
  `docs/evaluation-readiness.md` for the evaluation protocol.
- Do not deploy directly, publish a package, promote a runtime, or change
  production services as part of a local fix. Shipping requires explicit
  authorization and the repository's PR/GitHub Actions release process.
