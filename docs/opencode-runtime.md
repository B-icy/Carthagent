# CTG native OpenCode runtime

CTG runs the package-owned native OpenCode v2.0.32 CLI from the pinned
`@opencode/cli` dependency. It never downloads, replaces, or implicitly uses a
user installation. An explicitly supplied `CTG_OPENCODE_BIN` is accepted only
when its version is exactly 2.0.32.

Runtime identity records the concrete executable path and SHA-256, including
when an explicit bare command is resolved through the supplied `PATH`. A
healthy process registered to a different runtime remains untouched and blocks
selection changes. A dead registration, including a legacy record without an
identity, is removed only after its PID is confirmed dead, so it cannot
permanently prevent startup.

## Isolation and persistence

An additional separately distributed pinned source variant is documented in
[`opencode-owned-runtime.md`](./opencode-owned-runtime.md). It is opt-in via
`CTG_OWNED_OPENCODE_RUNTIME`; unset behavior remains the package-owned
`@opencode/cli@2.0.32` runtime described here.

The default CTG profile is `~/.carthagent/opencode`. `CTG_OPENCODE_HOME` (or a
`root` argument in the runtime API) can select another profile. CTG applies
private `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, and
`XDG_CACHE_HOME`, plus `OPENCODE_DB`, to native child processes. Config,
database, credentials, service registration, and cache therefore do not touch
the normal OpenCode service/profile. Profile directories are mode 0700 and
generated config is mode 0600. It also sets a private `HOME`,
`OPENCODE_TEST_HOME`, and `OPENCODE_CONFIG_DIR`, and uses OpenCode 2.0.32's
supported `OPENCODE_CONFIG_PROJECT_DISABLE` switch to disable project config
discovery. All inherited `OPENCODE_*` variables are removed before setting
CTG-owned profile values. It never copies user credentials. Authenticate with
the CTG-owned service to keep credentials independent. Workspace-local tool execution uses OpenCode's
session environment endpoint and retains the caller's existing environment.

The normal subprocess environment remains unchanged in the workspace. Use
`workspaceEnvironment(workspace, env)` to prepare the workspace process
environment; it adds the workspace marker but deliberately does not override
host XDG values. `setSessionEnvironment(service, sessionID, env, { location })`
applies it to native shell commands for that OpenCode session. TUI launch retains
the isolated OpenCode configuration while inheriting the workspace's actual
credentials through its normal parent environment.

## Runtime API

`lib/opencode/runtime.mjs` exports `runtimePaths`, `runtimeEnvironment`,
`provisionRuntime`, `resolveOpenCode`, `runCapture`, and
`workspaceEnvironment`. Provision with `pluginPath` pointing to the absolute
CTG plugin entry path (`plugins/carthagent`); this runtime does not bundle or
resolve the plugin on behalf of the CLI integration.

`lib/opencode/service.mjs` exports `ensureService`, `serviceRequest`,
`createSession`, `getSession`, `promptSession`, `cancelSession`, `sessionMessages`,
`setSessionEnvironment`, `stopService`, and `launchTui`. `ensureService({ root, pluginPath, profile, startupTimeout })`
returns the isolated service URL, auth headers, registration metadata, paths,
and executable after a health/version/PID check. Startup is bounded (20s by
default), concurrent ensure/stop calls serialize on one profile lifecycle lock,
and no normal OpenCode service is stopped or restarted. Use `launchTui` to open the
native OpenCode TUI pointed at CTG's environment, preserving workspace cwd and
native session flags.
The TUI attaches with the native CLI `--server` option and CTG service password;
it does not discover or start another background service. `runHeadless` accepts
an optional `timeout` in milliseconds (120 seconds by default), aborts the wait
request and interrupts the session on timeout/cancellation, and returns message
history in chronological order with the latest assistant result reconciled to
the newly accepted prompt.
`stopService({ root })` stops only the healthy process identified by that
profile's private registration. If a registered process is alive but unhealthy,
the registration is retained and an error is reported rather than orphaning or
duplicating the daemon. Lock recovery removes only dead-owner or sufficiently
old incomplete lock files. A persistent recovery marker causes bounded failure
with manual lock-file recovery guidance; CTG does not guess whether another
recovery owner is still active.

`lib/opencode/headless.mjs` exports `runHeadless` and the session helpers. It
uses native `/api/session`, `/prompt`, `/message`, `/interrupt`, environment,
and wait APIs. It polls the session projection and returns the refreshed session,
terminal outcome (`succeeded`, `failed`, `interrupted`, or `timed-out`), accepted
input, chronological messages, and the assistant result. Provider failures and
missing terminal outcomes are never reported as success. Polling handles transient
503 responses within the configured timeout; cancellation uses `resume=false`
and bounded requests. Slash templates
can be mapped through `nativeCommandConfig` in `compatibility.mjs` into native
OpenCode `commands` configuration. A real-host check is available via
`npm run test:native-host`; it uses disposable roots and validates native plugin
activation, RPC execution/result, and schema failures against v2.0.32.

The native CLI integration can use these signatures directly:

```js
const service = await ensureService({ root, pluginPath, profile });
const session = await createSession(service, workspace, { body: { title } });
await setSessionEnvironment(service, session.id, process.env, { location: workspace });
const result = await runHeadless(service, workspace, prompt, { signal, env: process.env });
const tui = launchTui(service, workspace, { sessionID: session.id, env: process.env });
await stopService({ root });
```

`runHeadless` returns `{ session, accepted, messages, result, outcome, terminal,
error, reason, budgetReason }`; `result` may be absent if the turn produced no
assistant message. Supply `location` to session helpers when the session's
workspace differs from the default.

Legacy CTG sessions are intentionally not imported into OpenCode. Keep any
archive/recovery policy in CTG's existing session store; this runtime only
creates native OpenCode sessions in the isolated profile.
