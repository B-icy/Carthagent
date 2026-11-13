# Daily goals

Open `/quests` or `/voyages` to see **Daily goals**: three quick wins for today,
such as:

- **Change 20 lines of code**
- **Run your tests**
- **Run a code review**
- **Make a commit**
- **Finish a task with ctg**
- **Finish a verified Ship task**

For variety, each goal rolls a tier for you each day: most are normal (10 coins
and 50 XP), some come up **★ Bigger** (double the target, 25 coins and 125 XP)
and a few **★ Stretch** (4× the target, 60 coins and 300 XP). The roll is fixed
for the day, so refreshing never changes it.

The three goals rotate every UTC day (no two count the same thing). Each shows
a progress bar and pays its reward once when it fills. There is
nothing to submit, select or consent to: `ctg` counts progress from your own
sessions in any mode (Ship, Quick, Plan or Build) and pays out automatically. A
toast celebrates each goal as it completes.

## What counts

| Metric | Counted when |
| --- | --- |
| Lines | An agent `edit`, `write` or patch succeeds: lines added plus lines removed. |
| Tests | A shell command runs your tests (`npm test`, `pytest`, `go test`, `cargo test`, …) or Ship runs a `delivery_check`. A failing run still counts: running the tests is the habit. |
| Reviews | `/review` starts the review loop, or Ship records a `delivery_review`. |
| Commits | A successful `git commit` from an agent shell. |
| Tasks | An agent turn that changed lines finishes successfully. |
| Verified | Ship finishes a task as `verified`. |

Counting is best-effort and never blocks, alters or fails a tool call. Today's
totals live in `<profile>/state/carthagent/daily-goals.json` and are reported to
Voyages a few seconds after they change (and whenever the page opens). The
server keeps the highest total it has seen, so retries are harmless.

**These are motivation, not verification.** Counts are reported by your own
`ctg` and are not checked against a repository; they are not a productivity
measure. Rewards for a verified Ship finish (`/voyages claim`) are separate.

## Page

`s` opens your Character, `r` refreshes, Esc returns to coding. The header shows
coins, level and the time until new goals. Signed out, `ctg` still counts
locally; sign in with `/login` to see goals and get paid.

On a runtime with navigation support, the left rail also has **Projects /
Voyages** modes. The Voyages navigator shows coins and **Quests** (daily
goals), **Shop** and **Character**; **Friends · WIP** is disabled. Switching
modes never creates, interrupts or closes a coding session.
