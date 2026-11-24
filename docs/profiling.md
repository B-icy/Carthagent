# Profiling

`tools/profile.mjs` records a CPU profile (and optionally a heap profile) of any Node command, then prints the hottest functions and writes a flame-graph input file. It needs no extra dependencies.

## Quick start

```sh
node tools/profile.mjs                                   # profiles `node bin/ctg.mjs --help`
node tools/profile.mjs -- node bin/ctg.mjs status --json # any command after `--`
node tools/profile.mjs --server                          # dashboard startup (node server.mjs)
node tools/profile.mjs --test tests/update.test.mjs      # one test file, in-process
node tools/profile.mjs --heap --top 25                   # add a heap profile, show 25 rows
```

| Option | Meaning |
| --- | --- |
| `--heap` | Also record a sampling heap profile (`--heap-prof`). |
| `--top <n>` | Rows per table (default 15). |
| `--out <dir>` | Output directory. Default: `artifacts/profiles/<timestamp>/` (ignored by git). |
| `--server` | Start `server.mjs` on a random port with the update check off, wait until it prints its URL, let it settle for 500 ms, then stop it gracefully. |
| `--test <file>` | Run `node --test --test-isolation=none <file>` so the test file runs in the profiled process. |

Profiling is switched on through `NODE_OPTIONS` (`--cpu-prof --cpu-prof-dir=…`), so it also works for commands that are not `node` themselves, such as `npm run …`. Every Node child process then writes its own profile into the same directory; the summary analyzes the largest one and says how many others exist.

Node writes a profile only when the process exits normally (including `process.exit()`). A process killed by a signal leaves no profile, which is why `--server` stops the dashboard through a `SIGTERM` handler that calls `process.exit(0)`.

## Output

Each run prints three tables and writes these files to the output directory:

| File | Contents | Open with |
| --- | --- | --- |
| `CPU.*.cpuprofile` | Raw V8 CPU profile | [speedscope.app](https://www.speedscope.app) (drag the file in), or Chrome DevTools → Performance → Load profile |
| `CPU.*.folded` | Collapsed stacks, one `frame;frame;frame count` line per distinct stack, weighted by sample count | speedscope, `inferno-flamegraph`, or Brendan Gregg's `flamegraph.pl` |
| `Heap.*.heapprofile` (with `--heap`) | Sampling heap profile | Chrome DevTools → Memory → Load |
| `summary.txt` | The printed tables without colors | Any editor |

The tables are:

- **Top by self time**: time spent in the function body itself. Look here for tight loops, hashing, JSON parsing and regular expressions.
- **Top by total time**: time in the function and everything it called. Under recursion a function is counted once per stack, so totals never exceed the profile duration.
- **Top first-party functions by total time**: the same, limited to code in this repository (outside `node_modules`). Rows marked `*` in every table are first-party; paths are relative to the repository root.

With `--heap`, a fourth table lists allocation sites by sampled live bytes.

Example (`node tools/profile.mjs --top 5` on a 1-CPU Linux arm64 machine, Node 24.22.1):

```text
Top 5 first-party functions by total time
*      36.6ms  18.7%  (anonymous)  bin/ctg.mjs:1
*      31.4ms  16.0%  createOpenCodeCliRuntime  lib/opencode/cli-runtime.mjs:625
*      29.5ms  15.1%  nativeModules  lib/opencode/cli-runtime.mjs:40
*      29.5ms  15.1%  load  lib/opencode/cli-runtime.mjs:42
*       2.7ms   1.4%  runOpenCodeCli  lib/opencode/cli.mjs:255
```

## Carthagent hot paths to watch

- **CLI startup and module loading.** Most of a short command such as `ctg --help` is ESM loading and compilation (`compileSourceTextModule`, `node:internal/modules/esm/*`). `bin/ctg.mjs` creates the full CLI runtime before routing, so even `--help` and `--version` load the native runtime modules through `nativeModules()` in `lib/opencode/cli-runtime.mjs`. Keep new imports on that path lazy (`await import()` inside the command that needs them).
- **Runtime resolution.** `resolveOpenCode()` in `lib/opencode/runtime.mjs` reads the pinned release manifest, then `acquireOwnedRuntime()` in `lib/opencode/runtime-artifact.mjs` re-hashes the cached runtime executable with SHA-256 on every launch (this is deliberate: the cache is writable, so only the pinned digest is trusted). On a cold cache it also downloads and unpacks the archive. Profile with an empty `CTG_OPENCODE_HOME` to see the first-run cost, and with a warm one to see the per-launch hash.
- **Update checks.** The passive check in `lib/update.mjs` is throttled to once a day through `~/.carthagent/update-check.json`. Set `CARTHAGENT_NO_UPDATE_CHECK=1` to remove it from a profile.
- **Dashboard requests.** `fingerprint()` in `lib/delivery.mjs` hashes the workspace on most `/api/*` requests. Profile the server with a large workspace (`CARTHAGENT_WORKSPACE=/path/to/repo`) if status requests feel slow.
- **Tests.** `--test` shows where a slow test file spends time; `spawnSync` near the top usually means the test starts child processes.

## Heap profiles and snapshots

`--heap` records allocations sampled over the whole run, which is enough to find what allocates the most. For leaks, take a heap snapshot instead: run the command with `node --heapsnapshot-signal=SIGUSR2 …`, send `kill -USR2 <pid>` before and after the suspected leak, and compare the two `.heapsnapshot` files in Chrome DevTools → Memory.

`*.cpuprofile`, `*.heapprofile` and `*.heapsnapshot` files are git-ignored, as is `artifacts/`. Profiles contain file paths and function names from your machine, so check them before sharing.
