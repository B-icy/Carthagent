# Built-in Jev planning critic

Jev is built into the delivery extension. It is off until explicitly enabled; presence of a credential alone never triggers paid calls.

```
OPENROUTER_API_KEY=... node bin/ctg.mjs --delivery-jev
# Or with direct TypeSafe credentials:
TYPESAFE_API_KEY=... node bin/ctg.mjs --delivery-jev --delivery-jev-provider typesafe
```

Flags must be passed to the pi/delivery session (CLI forwarding depends on invocation; `pi -e /absolute/path/extensions/delivery.ts --delivery-jev` is the direct form). Do not put keys in command arguments or project files.

After successful `delivery_design inspect`, the enabled critic automatically assesses the captured plan for SRP, DI seams and missing test assertions/boundaries. OpenRouter uses `typesafe/jev-1.13` at its Decisions endpoint, not a chat/router model. The direct TypeSafe adapter retains its existing model configuration.

- At most **three attempts per delivery run**, reserved in the report before network dispatch.
- Identical run/revision/digest/source inspections reuse a receipt, including unavailable/interrupted attempts. Changed plans/source get fresh identities, subject to the cap.
- Advice and its identity survive report/session restore and appear in status/recovery. Old receipts remain history, not fresh approval.
- Probabilities >=0.5 identify investigation topics; lower scores are not flags. The model is asked to record dispositions in ordinary adversarial review. No flags does not mean correct.
- Missing credentials, timeout and invalid data report unavailable. They do not grant approval or prevent normal review. No retries.
- Advice cannot alter requirements, resolve blockers, authorize execution, or replace checks/final review.
- Input max64KB, response max64KiB, OpenRouter deadline15s; direct TypeSafe retains3s default. Calls/unknown cost are visible but the normal adapter does not enforce an account-level dollar ceiling. Use provider limits or a trusted billing broker when needed.
- An explicit `--delivery-jev-broker http://127.0.0.1:PORT/jev` uses a trusted local supervisor without sending a provider key. Non-loopback and arbitrary endpoints are rejected. This is host configuration, not a model tool parameter.

Plan text is disclosed to the chosen external provider when enabled. It may contain confidential source information; no universal secret scrubber or zero-retention claim. Transport/provider failures are sanitized in reports. Jev is an additional fallible critic, not independent proof of delivery quality.
