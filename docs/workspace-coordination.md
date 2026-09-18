# Workspace coordination

CLI checks, extension delivery tools (TUI/headless), and dashboard mutations share an exclusive `.harness/workspace.lock` for the whole operation, including subprocess checks. Contention fails explicitly; operations are not silently replayed. Same-process extension calls retain FIFO ordering. Dashboard contention returns HTTP 409.

An explicit new plan selects `.harness/active.json`. Status/dashboard/CLI selection uses this pointer rather than report modification time. Legacy workspaces without a pointer retain newest-report discovery until a coordinated operation selects a run. A missing or invalid selected report fails closed.

Before each extension mutation, the latest same-run persisted state is reconciled. Superseded runs cannot write or trigger automatic repairs; explicitly creating a new plan can select fresh work once the workspace is idle. Dashboard mutations refresh state under the lock. Existing report version checks still reject non-cooperating stale writers. Failed operations are not automatically replayed, and new plans intentionally supersede idle runs rather than merging unrelated contracts.

Locks are cooperative, local filesystem controls, not security isolation or a distributed lease. They do not serialize arbitrary shell edits, reviewers, or external tools. A crashed process can leave a lock: inspect its PID and the report, confirm no writer/check child is alive, then remove the lock manually. Never steal locks based solely on age. Manual state-file edits can bypass these controls. Separate worktrees have separate coordination state.
