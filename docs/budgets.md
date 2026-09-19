# Session delivery budgets

The delivery extension supports opt-in execution limits on Windows, macOS,
Linux and WSL. These are agent orchestration controls, not a security sandbox
or a dollar/token billing cap.

Normal carthagent launches accept `--max-tools`, `--max-seconds`, and `--max-repairs`
for both TUI and headless mode. For example:

```text
node bin/carthagent.mjs -p --max-tools 100 --max-seconds 900 --max-repairs 2 "Implement the requested change"
```

Invalid or missing values, and budget options combined with `--no-delivery`,
fail before launching the engine. Use `/delivery-budget-status` to inspect
usage, remaining allowance (null means unlimited), and stop reason without
spending a tool call. The command displays a JSON status message.

Alternatively launch the bundled engine directly with the extension and flags
(from the repository root; works in PowerShell and POSIX shells):

```text
node vendor/agent/cli.js -e extensions/delivery.ts --delivery-max-tools 100 --delivery-max-seconds 900 --delivery-max-repairs 2
```

Each flag accepts an integer from 0 to 1000000. Zero disables that dimension;
all default to zero. The existing maximum of two automatic repair nudges per
user input still applies. The new repair limit additionally caps nudges over
the entire budget, including across user follow-ups.

- Tool calls count at admission, including status calls and subsequently blocked
  calls. Exactly N calls may be admitted; the next attempt stops the agent.
- Seconds measure wall time from budget creation, including idle time and time
  while the process is closed. An active turn has a timer that requests abort
  even if no tools are invoked. An idle expired session stops on its next run.
- Repair rounds count automatic delivery follow-ups, not arbitrary model turns.
- Limits and counters are stored as session entries independently of plans.
  Replanning, input, compaction and same-session tree navigation do not reset
  them. Restoration reads all session entries, not only the selected branch.
  Existing saved limits remain authoritative until reset.

When exhausted, the extension blocks tools, requests engine abort, suppresses
repair follow-ups, and emits a `delivery-budget-stop` JSON message containing
its reason, counters, requirements and last recorded evidence. That evidence
is a snapshot, **not a fresh verification**. The delivery report is not falsely
marked verified or overwritten; unfinished work remains unfinished.

To authorize more work, explicitly run `/delivery-budget-reset` while the agent
is idle. In headless mode a command-only invocation on a previously failed
session may still exit 1 because the engine prints its last assistant error;
the command's persisted reset is applied. Our offline subprocess regression
checks the saved reset and subsequent tool execution rather than treating that
exit code as proof that reset failed. It creates a fresh budget using the current launch flags. This is a
user command, not a model tool. A genuinely new session also starts a new budget.
Separate processes/sessions do not share a workspace-wide quota, and deliberate
session-file edits or extension removal can bypass the limits.

Cancellation is cooperative: engine/provider/tools must honor abort signals.
Detached subprocesses, uninterruptible synchronous code, and requests already
billed by a provider cannot be undone. Time limits are not hard OS process
termination deadlines. No paid-provider cancellation guarantee is implied.

Native Windows/macOS/Linux CI runs the regression suite on Node 22 and 24;
WSL is validated separately locally. This does not establish every terminal,
OS version, browser or processor architecture as tested.
