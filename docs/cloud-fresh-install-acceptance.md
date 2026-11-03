# Cloud fresh-install acceptance (in progress)

## Public installed baseline

On November 3, 2026, the normal global `carthagent@1.1.0-beta.2` installation
was uninstalled. Absence of `ctg` on PATH was verified, then
`npm install -g carthagent@next` installed public `1.1.0-beta.3`.

The normal profile was moved out before installation. A real tmux terminal
running bare `ctg` showed no selected provider and only a generic connection
action. `/login` put Cloud under Services, after OpenAI, Anthropic and Gemini.

## Restart and backup incident

The original profile was moved to a private directory under `/tmp/opencode`,
which was erased during the harness/server restart. This was an inadequate
backup location. The original normal profile has not been recovered. The
Invest-With-Friends workspace and its `.harness` directory still exist; they
were not moved or edited by the reinstall. Separate older native test profiles
survive but are not replacements for the lost normal profile.

Subsequent acceptance state is stored in a private durable directory under
`~/.local/share/carthagent-acceptance/`. The public beta installation and source
changes survived. The old isolated payment sandbox, local receipts and disposable
task under `/tmp/opencode` did not. Previously committed acceptance documents
remain the record of those earlier runs.

## Candidate changes

- Home names Carthagent Cloud and offers direct sign-in when no model is selected.
- The connection picker lists Cloud first, under Recommended.
- `/login` targets Cloud; `/connect` retains the provider picker.
- Terminal `ctg login` accepts Enter for its displayed recommended default.

## Candidate validation

The Linux candidate was compiled from pinned upstream source
`843a6c514e606b436a7fe713422ace0a93ad3d61` and combined-v6 patch
`31e15c7f92f82177bf1b6106732926951c4d751bde36b61f3e1e283818ea5631`.
Its executable SHA-256 is
`c35f0d340b9f38e30daf5ad78c945e46e90b1d2470241033cdd4e7b8271aa346`.
The patch applies cleanly to the pinned upstream tree.

Real tmux launches at 110 and 60 columns visibly show the Cloud action.
`/login` goes directly to Cloud device authorization. `/connect` lists Cloud
first under Recommended. Terminal `ctg login` lists Cloud first and pressing
Enter starts its authorization. Email authorization completed and the model
became available without manual provider configuration.

The runtime TUI typecheck, 11 integration-dialog tests, two narrow/wide
onboarding render tests, native plugin typecheck and launcher tests pass.
The full quality gate passes with 1,133 tests passing and five skipped, including
the additional headless-continuation fixes. The focused CLI/provider suite passes
59/59, including foreign-workspace rejection before a headless model switch.

## Combined real-model / Stripe-test journey

The durable isolated backend uses the real Cloud control plane, gateway and
ledger, a real OpenRouter model upstream, and Stripe test-mode Checkout and
signed webhooks. This is not production-upstream acceptance. Neither prices
nor usage consumption were mocked to cross the payment boundary.

Session `ses_e60d2dab0ffe6wz3L7236pcXer` started a Node.js streaming CSV expense
report CLI task. Eleven real Sonnet requests consumed $0.664548 of its $1
starter grant. A subsequent request received `provider.quota` / HTTP 429:
the remaining $0.335452 could not cover its required reservation. Nine files,
including source, tests and delivery evidence, were preserved and hashed.

Builder Checkout displayed $1 due today, then $10/month. One test-card payment
completed and signed `checkout.session.completed` and `invoice.paid` events
activated Builder. The task remained idle, all nine hashes stayed identical,
and request count remained 11 until explicit continuation after `billing refresh`.
The same session then made new real model calls using paid allowance.

Sonnet hit Builder's $0.50 daily reservation limit, so the same test subscription
was upgraded to Max through the ordinary confirmation page. The $49 prorated
test charge activated Max, retained the December 3 renewal date and preserved
consumption. Sonnet later hit Max's reservation ceiling too; a lower-cost real
DeepSeek V3.2 model was added to the sandbox to finish the existing task without
altering allowances or resetting consumed usage.

This uncovered two launcher defects addressed in this branch:

- Explicit headless `--session ... --model ...` must switch the existing
  session model before submitting the continuation, just as the TUI path does.
- A fixed two-minute transport observation timeout interrupted useful tasks
  despite a larger session execution budget. The launcher now allows at least
  30 minutes of observation, extending it for a larger explicit time budget.
  Persistent host execution budgets still apply; `--reset-budget` is explicit.

Final task completion and independent verification are still in progress.
Candidate changes are not published. The normal installation remains public
beta.3, now reauthenticated to the production test account. Its prior local
session history and settings have not been recovered.
