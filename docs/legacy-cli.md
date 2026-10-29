# Current default CLI: install, providers, Ship, and console

> This page documents the **currently-default regular (legacy) CLI** while
> native OpenCode remains opt-in with `CTG_NATIVE=1`. Its configuration and
> data paths are not the native OpenCode profile. Keep this guide available
> until the native default switch is accepted; it can then be archived or
> retired as part of that migration.

## Install the current CLI

Core CLI requires Node ≥ 22.19. Optional workflows may need Git and an
authenticated `gh` for PR review, Python and scenario dependencies for game
graders, and a browser download for real-browser checks. The browser helper
downloads `chrome-headless-shell` on first use to `~/.carthagent/browser/`; no
local browser installation is needed. An external WebDriver endpoint is also
supported.

Install Carthagent:

```sh
npm install -g carthagent
ctg
```

If the shell cannot find `ctg`, restart the terminal and confirm npm's global
executable directory is on `PATH` (`$(npm prefix -g)/bin` on Linux/macOS; the
directory shown by `npm prefix -g` on Windows).

If npm reports `ENOTDIR`, `EEXIST`, or `ENOTEMPTY` while replacing
`node_modules/carthagent`, inspect the global install directory for a stale
entry from an earlier install or `npm link`. Preserve anything you need before
moving only the identified stale entries out of the way; then retry:

```sh
npm root -g
# After reviewing the exact paths, move the stale carthagent entry/stash aside.
npm install -g carthagent
```

The regular CLI's `ctg update` has cleanup-and-retry behavior for these stale
global-install rename failures. Do not apply that legacy updater behavior to the
native updater, which has a different contract; see [native upgrade guidance](native-upgrade.md).

For a development checkout:

```sh
git clone https://github.com/B-icy/Carthagent
cd Carthagent
npm ci && npm install -g .    # or run node bin/ctg.mjs directly
```

## Provider authentication

The regular CLI stores its provider credentials in
`~/.carthagent/agent/auth.json`; the native preview has a different isolated
credential store and profile. Do not copy or merge profile files to switch
runtimes.

Run `ctg login`, or use `/login` (`/auth`) inside the regular console. Carthagent
Ship is offered as the managed option, while Anthropic, OpenAI, OpenRouter and
other supported direct providers can also be connected. The login UI handles
OAuth URLs, device codes, and provider-supported API-key prompts. You can also
provide a provider key through its environment variable, for example:

```sh
export ANTHROPIC_API_KEY=...  # or OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, XAI_API_KEY, ...
ctg
```

Multiple provider credentials can coexist. In the regular console, `^t`
(settings) has provider and model rows; `←→` changes providers, and the model
picker is scoped to the selected provider. `/login` can connect another
provider. Override the model for one run with `--model <id>`; the last choice
is saved to `~/.carthagent/config.json` for the regular CLI.

### Carthagent Ship

Choosing Ship in the login UI starts browser device authorization. Carthagent
stores the resulting short-lived access token and rotating refresh token in its
regular CLI credential store. After signing in:

```sh
ctg account                    # credit, grants, plan, and CLI sessions
ctg billing checkout           # checkout URL
ctg billing portal             # customer portal URL
ctg logout-cloud [session-id]  # revoke current or named CLI session
```

The regular console also offers `/account`, `/billing checkout`, `/billing
portal`, and `/logout-cloud <session-id>`. Direct provider/API-key options
remain available if managed Ship credit is unavailable. A direct `EXPLABS_API_KEY`
environment key, where configured by an operator, is separate from the public
Ship device flow.

`CARTHAGENT_CLOUD_URL` overrides the Carthagent account/control-plane origin.
`EXP_GATEWAY_URL` specifically overrides the direct upstream model gateway for
preview or staging. Browser-account requests use the Ship control-plane
authority; API-key requests use the configured upstream gateway. Model
identities are discovered from `GET /v1/models`; published operating caps may
restrict catalog model limits. Pricing metadata is not inferred from that
endpoint. See the control-plane/operator documentation for hosted request and
billing behavior.

## Regular console and commands

```sh
ctg                           # interactive split-terminal console
ctg "Build a task CLI"        # console with an initial task
ctg -p "Summarize this repo"  # headless output (also automatic without a TTY)
ctg demo                      # scripted mock; no provider needed
ctg status                    # fingerprint, contract, pending checks
ctg check all                 # run declared checks
ctg account                   # Ship account details
ctg billing checkout          # Ship checkout link
ctg serve                     # web dashboard
ctg test                      # unit suite
ctg update --check            # check for a release without installing
ctg update                    # update using the regular CLI updater
ctg --help                    # all commands/options
```

Inside the regular console: `enter` send/steer · `esc` abort (again force-
restarts the engine) · `^r` session picker · `tab`/`⇧tab` panes · `x` expand
tool output · `^v` paste · `/copy` copy the full last assistant response · `^t`
settings · `^c` quit. Drag-select copies text; at the pane edge, continue
holding to scroll during selection. Clipboard writes use native tools and OSC
52; remote terminals may need clipboard permission and may impose size limits.
Regular sessions persist under `~/.carthagent/agent/sessions/`; `ctg -c`
continues the latest and `ctg -r` opens the picker.

### Themes and useful flags

The regular console provides the `carthage` purple/gold theme, dark themes
(`opencode`, `tokyonight`, `nebula`, `ember`, `forest`, `mono`, `obsidian`,
`midnight`, `nord`, `solarized-dark`, `okabe-dark`, `contrast-dark`), light
themes (`paper`, `daylight`, `solarized-light`, `okabe-light`,
`contrast-light`), and adaptive `solarized`, `okabe`, `contrast`, and `system`
themes. Select with `--theme`, `/theme`, or `^t`; the dashboard theme picker
persists its choice separately in browser `localStorage`.

Common options include `--model`, `--thinking`, `--validators <file>`,
`--context <file>`, `--bash-cap <sec>`, `--review ask|yes|no`, `--isolate`,
`--no-delivery`, `--no-guide`, `--ascii`, `--glyphs <mode>`, `-c`, `-r`, and
`--session`. `--glyphs auto` selects Unicode where supported and otherwise
falls back to ASCII; set `--ascii`, `--glyphs unicode|ascii`,
`CARTHAGENT_GLYPHS=unicode|ascii`, or `CARTHAGENT_ASCII=1` to override.

For native preview behavior and its separate paths, see the [native upgrade
guide](native-upgrade.md). Native migration acceptance remains open; this page
continues to describe the default until that status changes.
