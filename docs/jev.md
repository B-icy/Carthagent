# Built-in Jev planning critic

Jev is built into the delivery extension. On Carthagent Ship (managed cloud) it is **on by default** — advice rides the managed `/v1/jev` endpoint, which the backend proxies to Experiential's free System One endpoint (`jev-latest`) outside the billing gateway, so it never draws on managed usage. Presence of a credential alone never triggers paid calls on BYOK providers.

```
# Carthagent Ship: enabled automatically; opt out with a literal false value
node bin/ctg.mjs --delivery-jev=false

# BYOK providers still require explicit opt-in:
OPENROUTER_API_KEY=... node bin/ctg.mjs --delivery-jev
# Or with direct TypeSafe credentials:
TYPESAFE_API_KEY=... node bin/ctg.mjs --delivery-jev --delivery-jev-provider typesafe
```

Flags must be passed to the pi/delivery session (CLI forwarding depends on invocation; `pi -e /absolute/path/extensions/delivery.ts --delivery-jev` is the direct form). Do not put keys in command arguments or project files.

Schema repair is deterministic and free of advisor calls: use `delivery_design action=guide`, validate and repair references first. Invalid inspection neither dispatches Jev nor consumes an advice attempt.

The disclosed semantic input includes goal, exact acceptance, **check definitions (including executable argv), outputs and assumptions**, design and workflow. These additional fields let Jev assess scenario-to-check links and promised-output coverage; they can contain confidential paths/arguments and are sent to the chosen provider only while advice is enabled (automatic on Ship). The 64KB bound still applies; larger input becomes unavailable rather than silently truncated. Commands are declarations, not proof of execution.

After successful `delivery_design inspect`, the enabled critic automatically assesses the captured plan for SRP, DI seams and missing test assertions/boundaries. Ship calls go to `POST {control-plane}/v1/jev` with the session OAuth token — no provider key needed. OpenRouter uses `typesafe/jev-1.13` at its Decisions endpoint, not a chat/router model. The direct TypeSafe adapter retains its existing model configuration.

- At most **three attempts per delivery run**, reserved in the report before network dispatch.
- Identical run/revision/digest/source inspections reuse a receipt, including unavailable/interrupted attempts. Changed plans/source get fresh identities, subject to the cap.
- Advice and its identity survive report/session restore and appear in status/recovery. Old receipts remain history, not fresh approval.
- Probabilities >=0.5 identify investigation topics; lower scores are not flags. The model is asked to record dispositions in ordinary adversarial review. No flags does not mean correct.
- Missing credentials, timeout and invalid data report unavailable. They do not grant approval or prevent normal review. No retries.
- Advice cannot alter requirements, resolve blockers, authorize execution, or replace checks/final review.
- Input max64KB, response max64KiB, OpenRouter deadline15s; direct TypeSafe retains3s default. Calls/unknown cost are visible but the normal adapter does not enforce an account-level dollar ceiling. Use provider limits or a trusted billing broker when needed.
- An explicit `--delivery-jev-broker http://127.0.0.1:PORT/jev` uses a trusted local supervisor without sending a provider key. Non-loopback and arbitrary endpoints are rejected. This is host configuration, not a model tool parameter.

Plan text is disclosed to the chosen external provider when enabled. It may contain confidential source information; no universal secret scrubber or zero-retention claim. Transport/provider failures are sanitized in reports. Jev is an additional fallible critic, not independent proof of delivery quality.
