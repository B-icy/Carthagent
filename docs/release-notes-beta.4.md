# Carthagent 1.1.0-beta.4

## Cloud-first onboarding

- Fresh home shows **Continue with Carthagent Cloud** and explains sign-in and eligible starter credit.
- `/login` opens Cloud authorization directly. `/connect` opens the provider picker with Cloud first under Recommended.
- Terminal `ctg login` accepts Enter to choose its recommended Cloud default.

## Continuing useful tasks

- An explicit model selection when resuming a headless session now changes that session's model before continuing.
- Headless observation allows at least 30 minutes instead of interrupting tasks after two minutes. Persistent execution budgets still apply, and `--reset-budget` remains an explicit authorization.

## Validation scope

The onboarding candidate was exercised in real narrow and wide terminals, with email authorization and actual model calls. A real Cloud ledger and Stripe test-mode payment verified quota rejection, payment activation, and explicit paid continuation of the same session. Payment alone did not restart the task or modify its files.

Independent review rejected the generated expense-reporting task as unfinished and incorrect; this release does not claim successful completion of that task or production inference acceptance. See [the acceptance record](cloud-fresh-install-acceptance.md) for details and the local-profile backup incident.
