# Native daily coding quests

Open `/quests` or `/voyages` to see **Quests**. On a development
runtime with navigation support, the left rail also has **Projects / Voyages**
modes. Switching modes does not leave the main page or create, interrupt, or
close a coding session. The Voyages navigator shows your coin balance and three
destinations: **Quests**, **Shop**, and **Character**. **Friends · WIP** is a
disabled destination, excluded from keyboard selection and without a route or
network action. Select an entry explicitly to open its page;
opening a quest may prepare evidence from the selected session, but never grants consent or uploads it. **Coding**
opens the selected session, or Home when no session is selected.

The rail keeps each mode's selection and scroll position. Its compact layout
uses readable short labels in an 11-cell rail. At widths
that cannot fit the rail, use the command palette, `/voyages`, or `/quests`.
Badges and friends have no native views yet. Older released runtimes keep slash-command navigation.

The quest board shows unfinished quests by default. **Completed (N)** (`c`)
opens completed quests from the current daily slate; `c` or Escape returns to
active quests. Completion stays visible on its detail page until you leave.
An empty active board shows **All quests complete** and the reset time. This is
not an all-time quest archive.

Use the native Carthagent Ship
device sign-in. The client uses the existing configured Carthagent API and scoped
bearer connection. Signing in, running Ship, or finishing a local delivery does
not consent to grading and never automatically uploads evidence.

## Choose work and submit

1. Refresh and select one of the server's daily assignments. The server supplies
   the title, kind, rubric, criteria, UTC day and closing time. There are no
   locally generated objectives or invented completion states.
2. Choose completed Ship work if it is not already selected. The picker lists
   readable recorded work in this folder. Access is limited to an owned session
   and its exact active report; historical completed runs are not selectable.
   The page assembles goal, change, checks, and findings from that report.
3. Review the conditions and selected work. **Recorded** means a local record
   exists, not that the assessor has accepted the condition. **Details** contains
   the selected text, check results, findings, identifiers, rubric and retention
   information. **Edit selected work** changes the goal/change summary or removes
   individual checks/findings. Included text may contain private information;
   automatic secret detection is not promised.
4. Choose **Submit** once. This explicitly authorizes the frozen selected work
   shown on the page. Selection, navigation, Refresh and status polling never
   upload it. Invalid fields, revision mismatches and UTF-8 limits fail before
   dispatch. Oversized evidence omits whole records with a visible notice.
5. The page shows processing, completion, or missing-evidence guidance. Completion
   leads with **Back to quests**. A regression needs a specific assertion's
   before/after result, not merely a setup error or generic failed marker.

Use **Up/Down**, **Enter** and **Escape** for navigation; **Ctrl+U/D** scrolls
the summary and Details independently of the pinned action list. Draft selections
survive leaving and reopening the page in the same process, scoped to account and
location. They do not survive application exit. Submitted requests use the durable
recovery journal described below.

Account, connection or location invalidation clears the local draft/preview and
closes this page's pending dialogs; it never preserves old consent. If evidence
selection or confirmation was interrupted, a page notice explains the cancellation
and the actions selection resets to **Refresh**, not Back. Refresh and review
again before giving fresh consent. No request is resent automatically. A request
that already started may still have reached the server: check its stable ID in
the recovery journal rather than assuming cancellation withdrew it.

The report's integer plan revision is not a source revision. The source-backed
projection uses the actual workspace fingerprint. A validated baseline can record
failed-before execution, but the projection does not include the original failure
output or a complete check history. The first failure can be a setup error. Explain
the genuine failing assertion truthfully in the change summary when necessary;
the marker alone is not semantic regression proof. Edited text remains a user claim.
Project/outcome/run UUIDs are stable references, not proof of authorship. Keep
those IDs when revising the same outcome. A separate outcome must describe
genuinely different work, not evade retained-outcome restrictions.

Every check has `name`, `before` (`failed` or `not_run`), `after` (`passed`,
`failed`, or `not_run`), `revision` (40/64 hex), and `result`. A passing check's
revision must equal the evidence revision. Every finding has `issue`,
`evidence`, and `resolution`. Empty arrays are valid but do not prove criteria.
Only enter `before: "failed"` if an actual earlier failure was observed.
There can be at most 12 checks and 5 findings. The complete canonical evidence
must fit 12,288 UTF-8 bytes, and the request 16,384 bytes. Per-field byte limits
are enforced before trimming, so shortening/redacting may be necessary.

## Processing and recovery

HTTP acceptance is not completion. **Queued** and **grading** are pending.
**Graded** has a separate decision: classifier-assessed complete, not met, or
needs evidence. **Failed** is an operational processing failure, not a negative
coding assessment. The displayed scores are uncalibrated rubric scores, not
confidence or probabilities. Only server state determines completion.

The native server persists the exact selected request and submission UUID in a
private profile-wide journal before sending. An uncertain send must be polled
by that UUID, or explicitly replayed with the same saved ID and body. Refresh
and poll are read-only and never replay. A new UUID is not a network retry.
The saved records remain available after midnight; a job accepted before the
UTC boundary can finish afterward. Validation/authentication/conflict failures
are not reasons for blind retries.

Accepted submissions need only their IDs for polling, so local raw payloads are
erased when acceptance is known. Unknown-send raw payloads are retained for
exact recovery for up to 24 hours, purged on the next journal access. This is
not a background deletion timer. **Erase local payload** removes those bytes
while retaining IDs for read-only status checks. It cannot cancel a backend
job or withdraw evidence already sent. Corrupt or unwritable journals fail
closed rather than sending without durable recovery.

## External processing and retention

Carthagent receives the exact selected request. External **JEV** receives the
revision, goal, change, selected checks/findings and server rubric, not the
project/outcome/run UUIDs. The flow does not upload a transcript, archive,
whole project, full review capture, or full check log. Included output tails
and authored text still require your privacy review.

Backend raw evidence is pending for up to 24 hours and erased on terminal
processing; outages can delay cleanup. Backend metadata is retained for
90 days. Provider policy applies. Immediate provider or backup deletion is
not promised. Local metadata is retained for recovery, with bounded storage
and expiry applied on journal access.

Assessment is based on submitted evidence, **not independent verification**.
There are **no coins, XP, distance, inventory, or other rewards** in this flow.
Editable personal quests remain separate from server daily assignments.

## Validation boundary

Offline contract, persistence, ownership, schema and UI-controller tests do not
prove production provider accuracy or a live native submission. The November 3
development acceptance pass completed two real daily quests through the Windows
Terminal UI, with server results checked separately. See
[native UX acceptance](native-ux-acceptance-2026-11-03.md) for scope, screenshots,
runtime identity, and remaining gaps.

The navigator's real-component renderer tests run with Bun 1.4.2 through
`npm run test:native-navigation`. They use isolated, synthetic account summaries
and do not contact a provider. They cover focus ownership, modal guards,
compact mode, preserved selection/scroll, and read-only route selection. They
are not live authentication, grading, or full rebuilt-runtime acceptance.

Run the new boundary on the real pinned native host without external grading:
`node tools/test-native-daily-quests.mjs`. This checks registration, all six
declared authentication failures, and actual local source projection through
the host's output validator. Its constructed report is a schema fixture,
not evidence that a check ran or a substitute for live submission acceptance.
