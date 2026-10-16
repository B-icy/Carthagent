# CTG native OpenCode runtime

CTG runs the native OpenCode v2.0.32 CLI and service. It never downloads or
replaces an OpenCode executable. Resolution checks `CTG_OPENCODE_BIN`, the
user-local `~/.opencode/bin/opencode`, then `PATH`; a different version is
rejected with a clear error.

## Isolation and persistence

The default CTG profile is `~/.carthagent/opencode`. `CTG_OPENCODE_HOME` (or a
`root` argument in the runtime API) can select another profile. CTG applies
private `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, and
`XDG_CACHE_HOME`, plus `OPENCODE_DB`, to native child processes. Config,
database, credentials, service registration, and cache therefore do not touch
the normal OpenCode service/profile. Profile directories are mode 0700 and
generated config is mode 0600. Existing provider auth is not copied: authenticate
with the CTG-owned service to keep credentials independent.

The normal subprocess environment remains unchanged in the workspace. Use
`workspaceEnvironment(workspace)` for CTG-managed workspace children; it adds
the workspace marker but deliberately does not override host XDG values.

## Runtime API

`lib/opencode/runtime.mjs` exports `runtimePaths`, `runtimeEnvironment`,
`provisionRuntime`, `resolveOpenCode`, `runCapture`, and
`workspaceEnvironment`. Provision with `pluginPath` pointing to the absolute
CTG plugin entry path (`plugins/carthagent`); this runtime does not bundle or
resolve the plugin on behalf of the CLI integration.

`lib/opencode/service.mjs` exports `ensureService`, `serviceRequest`,
`createSession`, `promptSession`, `cancelSession`, `sessionMessages`,
`stopService`, and `launchTui`. `ensureService({ root, pluginPath, profile, startupTimeout })`
returns the isolated service URL, auth headers, registration metadata, paths,
and executable after a health/version/PID check. Startup is bounded (15s by
default), concurrent calls converge on the private service registration, and
no normal OpenCode service is stopped or restarted. Use `launchTui` to open the
native OpenCode TUI pointed at CTG's environment, preserving workspace cwd and
native session flags.
`stopService({ root })` stops only the healthy process identified by that
profile's private registration and is safe to use without affecting the normal
OpenCode service.

`lib/opencode/headless.mjs` exports `runHeadless` and the session helpers. It
uses native `/api/session`, `/prompt`, `/message`, `/interrupt`, and wait APIs, returns
structured session/message data, and supports an AbortSignal. Slash templates
can be mapped through `nativeCommandConfig` in `compatibility.mjs` into native
OpenCode `commands` configuration.

Legacy CTG sessions are intentionally not imported into OpenCode. Keep any
archive/recovery policy in CTG's existing session store; this runtime only
creates native OpenCode sessions in the isolated profile.
