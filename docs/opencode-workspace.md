# CTG native OpenCode orchestration

CTG's native workflow treats a task, worktree, and session as a durable logical unit. New task sessions are independent root sessions created with an explicit `location.directory`; CTG deliberately does not create OpenCode child sessions because native children inherit the parent's location. Each native worktree keeps its own `.harness` evidence naturally, while the project-level canonical checkout stores `.harness/opencode-tasks.json` as the task relationship and operation journal.

The native API requires `projectID` for worktree create/list/refresh/remove. Use `ctx.location.project.id` and `ctx.location.project.canonical`, the latter as the canonical plugin/configuration root. Live `session.*` and `worktree.updated` events are invalidation hints only: re-fetch native and CTG task state; do not treat events as durable state or replay missed events.

## Durable operations

Each create intent is persisted before calling the OpenCode APIs. Successful worktree + root session creation completes the journal entry and records the task. If the operation fails between native API calls, its intent remains `recovery-required`; reconciliation only repairs outcomes that can be verified and never blindly retries a worktree/session create. The JSON state is atomically replaced, and a cooperative exclusive lock serializes local CTG writers. A leftover lock is an explicit recovery condition, not an invitation to steal it automatically.

## Legacy Pi archive

Pi JSONL files are read-only archive inputs. Listing, searching, transcript display, and JSON/JSONL export are supported; malformed lines are reported with line numbers and valid records remain available. This code does not import, migrate, mutate, or resume archived sessions. All new work starts in a fresh OpenCode session.

## Reviews

Local delivery review and remote PR review are separate modes. Local delivery review snapshots the exact local diff and HEAD, opens a fresh explicitly located reviewer session, validates structured findings, and rechecks that both source and HEAD remain unchanged before admitting the result. Reviewer sessions deny edit and shell permissions. `startPullRequestReview` requires exact matching local, remote, and PR heads and a callback that rechecks all refs and exact source after review. Existing `.harness/reviews` state via `lib/review-state.mjs` enforces the three-attempt limit. Neither mode pushes or merges. The default reviewer model is `lattice/gpt-6-luna` variant `high`, configurable by the service. No automatic merge permission is granted.

## Reusable module contracts

- `createTask({ ctx, projectID, canonical, task, from?, branch?, model?, agent? })` returns a persisted `{ id, task, projectID, canonical, worktree, sessionID, parentTaskID, status, createdAt }` task record.
- `listTasks({ canonical, includeOperations? })` returns the records, optionally with the operation journal.
- `reconcileTasks({ canonical, sessionIDs })` returns `{ tasks, operations }` without retrying APIs.
- Archive exports: `listLegacyArchive({ roots })`, `searchLegacyArchive({ roots, query })`, `readLegacyTranscript({ path })`, and `exportLegacyTranscript({ path, format? })`.
- Review exports: `startReview({ ctx, cwd, identity?, model?, agent? })`, `startPullRequestReview({ ctx, cwd, identity, localHead, remoteHead, pullRequestHead, source, readCurrent, model?, agent? })`, `createReviewSnapshot({ source, head })`, and `verifyPullRequestHeads({ localHead, remoteHead, pullRequestHead })`.
- `registerOrchestration(ctx, options?)` in `plugins/carthagent/src/server/orchestration.ts` returns these operations in a server-oriented facade and an event `watch(signal)` invalidation stream.
