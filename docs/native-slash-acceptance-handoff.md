# Native slash-command acceptance handoff

Status: **incomplete / not ready to publish**. This is retained handoff evidence,
not a passing product acceptance claim.

## Scope and candidate

- Source base: `00d4a173f24b038067244386667e6648dd06c679`.
- Candidate runtime: `/home/baissi/.local/share/opencode/ctg-runtime-prebuild-39097969783/verified-cache/1.1.0/linux-x64/cli-linux-x64/bin/opencode`.
- Trusted manifest: `/home/baissi/.local/share/opencode/ctg-runtime-prebuild-39097969783/ctg-runtime-candidate-1.1.0/runtime-release.json.candidate`.
- The manifest's `linux-x64.executableSha256` and the selected executable both
  matched `e9af36982c82a38666450376ebc80026348269bce1663163f3043a99bc70303c`
  before the native test runner invoked the runtime.
- Fixture: real native OpenCode host, exact `carthagent` plugin inventory
  activation, loopback-only OpenAI-compatible provider, disposable profile and
  project, strict child environment. No browser or real provider was used.
- PTY interactions submitted slash text and did not count autocomplete display
  as successful dispatch.

## Retained evidence

Latest proof: `/tmp/opencode/ctg-slash-acceptance-proof.json`
Latest runner log: `/tmp/opencode/ctg-slash-acceptance-logs.json`

Observed outcomes in the recorded partial run:

- `/export [file]`: handler wrote a complete HTML document; hostile session
  content was escaped and not executable.
- `/guide <task>`: provider received the delivery-framed prompt.
- `/raw <prompt>`: provider received the exact unframed text.
- `/workflow`, `/architecture`, `/evidence`: each actual slash submission
  rendered its corresponding Carthagent route, including observed empty/unknown
  receipt state rather than invented success.
- `/stats`: **failed**. The runtime selected the native host stats command rather
  than CTG's plugin stats handler; the session token/cost unknown-value labels
  were therefore not verified.
- `/guide` toggle: **failed**. The subsequent provider request remained framed;
  the no-argument plugin handler was not dispatched by the tested input path.

## Follow-up needed

Investigate slash dispatch against the exact candidate's native TUI behavior,
especially duplicate host/plugin command names and no-argument commands. Add
focused runtime-native dispatch coverage if the current registration API cannot
express those handlers reliably. Then rerun a fresh exact-session, plugin-active
offline PTY test and update this document with the exact resulting proof/log paths.
Do not represent the current partial proof as acceptance.

No product source change is retained for the unverified `/stats` experiment.
