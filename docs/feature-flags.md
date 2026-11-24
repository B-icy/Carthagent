# Feature flags

Carthagent's feature flags are first-party and stay on the user's machine.
They put unfinished or opt-in behavior behind a switch that can be turned on
for some users and off again without a release.

- Registry and resolution: [`lib/feature-flags.mjs`](../lib/feature-flags.mjs)
- Lifecycle gate: `node tools/check-feature-flags.mjs`
- Inspect on a machine: `ctg flags` or `ctg flags --json`

## How a flag is decided

`isEnabled('<name>')` returns the first match in this order:

1. **Environment**: `CTG_FLAG_<NAME>=on|off`, where `<NAME>` is the flag name
   in upper case with `-` replaced by `_`. For example,
   `CTG_FLAG_ADVANCED_AUTH=on`. `true|false|1|0` also work. Any other value
   is ignored.
2. **Legacy environment switch**: only for flags that replaced an older
   variable (`legacyEnv` in the registry). The old variable keeps its exact
   meaning: `CARTHAGENT_ADVANCED_AUTH=1` turns `advanced-auth` on.
3. **User file**: `~/.carthagent/flags.json`, or the file named by
   `CARTHAGENT_FLAGS_FILE`. It sits next to `update-channel.json` and
   `config.json` as per-user settings. Agent state lives separately in the
   `CARTHAGENT_CODING_AGENT_DIR` directory. Inside the native runtime, whose
   `HOME` is a private profile, `~` here means the real home that `ctg`
   passes as `CTG_USER_HOME`, so the login dialog sees the same file as
   `ctg flags`.

   ```json
   { "version": 1, "flags": { "advanced-auth": "on" } }
   ```

   If the file is malformed, it is ignored as a whole. An unknown flag name or
   a value other than on/off is skipped. Each case prints a warning in
   `ctg flags` and never stops Carthagent.
4. **Update channel** (`ctg update --channel`): the stage decides which
   channels get the flag on by default.

   | Stage | stable | beta | experimental |
   | --- | --- | --- | --- |
   | `off` | default | default | default |
   | `experimental` | default | default | on |
   | `beta` | default | on | on |
   | `on` | on | on | on |

   If the channel file cannot be read, the channel step is skipped.
5. **Registry default** (`default`).

An unregistered name throws `Unknown feature flag`, so a typo fails loudly in
tests.

## Add a flag

1. Add an entry to `FEATURE_FLAGS` in `lib/feature-flags.mjs`:

   ```js
   Object.freeze({
     name: 'my-feature', // kebab-case
     description: 'What turning it on changes, in user terms.',
     owner: '@github-handle',
     default: false, // must reproduce today's behavior
     stage: 'off', // off | experimental | beta | on
     expires: 'YYYY-MM-DD', // at most about six months out
   }),
   ```

2. Gate the behavior with a string literal, so that the checker can find it:

   ```js
   import { isEnabled } from '../lib/feature-flags.mjs';
   if (isEnabled('my-feature', { env })) { ... }
   ```

   Pass the `env` the surrounding code already uses, so that tests can inject
   it. Unit tests can also inject `readFile` and `channel`.

3. Test both states. Set `CTG_FLAG_MY_FEATURE` in the test's env, or pass a
   `channel`.

## Roll it out

Promote the stage one release at a time: `off`, then `experimental`, then
`beta`, then `on`. Users can opt in early with the environment variable or
`flags.json`, and a user who hits a problem can turn the flag off the same
way. Moving to `on` also requires `default: true`.

## Remove it

A flag is temporary. When it reaches `on` and has shipped in a stable release,
or when the experiment is abandoned:

1. Delete the `isEnabled('my-feature')` branches and keep the winning
   behavior.
2. Delete the registry entry.
3. Run `node tools/check-feature-flags.mjs`.

`tools/check-feature-flags.mjs` fails when:

- a flag is past its `expires` date (dead flag). Finish the removal, or extend
  the date with a reason in the commit message;
- source calls `isEnabled('<name>')` for an unregistered flag;
- a registered flag is never referenced, which means it is left over after
  removal;
- a file that imports `feature-flags.mjs` calls `isEnabled()` without a
  string literal;
- a registry entry is malformed.

The checker scans `bin/`, `lib/`, `extensions/`, `tools/`, `server.mjs`,
`evaluate.mjs` and `plugins/carthagent/`, skipping tests and fixtures.

## Current flags

| Flag | Stage | Default | Expires | Gates |
| --- | --- | --- | --- | --- |
| `advanced-auth` | off | off | 2027-05-20 | The "Advanced: use an Experiential API key" method for Carthagent Cloud in the native login dialog (`plugins/carthagent/src/server/providers.ts`). It replaces the `CARTHAGENT_ADVANCED_AUTH=1` switch, which still works. |
