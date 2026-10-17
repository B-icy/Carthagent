import { createTask, listNativeSessions, listNativeWorktrees, listTasks, reconcileTasks } from "../../../../lib/opencode/workspace.mjs"
import { exportLegacyTranscript, listLegacyArchive, readLegacyTranscript, searchLegacyArchive } from "../../../../lib/opencode/archive.mjs"
import { startReview, startPullRequestReview, verifyPullRequestHeads } from "../../../../lib/opencode/review.mjs"
import type { Context as PluginContext } from "@opencode/plugin/promise/plugin"

export type Orchestration = ReturnType<typeof registerOrchestration>

export type OrchestrationOptions = {
  legacyRoots?: string[]
  reviewModel?: { providerID: string; id: string; variant?: string }
  onInvalidate?: () => void
}

/** Domain surface used by the CTG native RPC registration; event streams only invalidate caches. */
export function registerOrchestration(ctx: PluginContext, options: OrchestrationOptions = {}) {
  const canonical = ctx.location.project.canonical
  const projectID = ctx.location.project.id
  if (!canonical || !projectID) throw new Error("CTG orchestration requires the canonical project location and projectID")
  const legacyRoots = options.legacyRoots ?? []
  return {
    createTask: (input: { task: string; from?: string; branch?: string; model?: { providerID: string; id: string; variant?: string }; agent?: string; parentTaskID?: string | null }) => createTask({ ctx, canonical, projectID, ...input }),
    listTasks: (input?: { includeOperations?: boolean }) => listTasks({ canonical, ...input }),
    async snapshot() {
      const [sessions, worktrees] = await Promise.all([
        listNativeSessions({ ctx, canonical, projectID }),
        listNativeWorktrees({ ctx, canonical, projectID }),
      ])
      return { projectID, canonical, tasks: listTasks({ canonical }), sessions, worktrees }
    },
    async reconcile() {
      const [sessions, worktrees] = await Promise.all([
        listNativeSessions({ ctx, canonical, projectID }),
        listNativeWorktrees({ ctx, canonical, projectID }),
      ])
      return reconcileTasks({
        canonical, projectID,
        sessionIDs: sessions.map((session: { id: string }) => session.id),
        worktreeDirectories: worktrees.map((worktree: { directory: string }) => worktree.directory),
      })
    },
    archive: {
      list: () => listLegacyArchive({ roots: legacyRoots }),
      search: (query: string) => searchLegacyArchive({ roots: legacyRoots, query }),
      transcript: (path: string) => readLegacyTranscript({ path, roots: legacyRoots }),
      export: (path: string, format?: "json" | "jsonl") => exportLegacyTranscript({ path, format, roots: legacyRoots }),
    },
    startReview: (input: { cwd: string; identity?: string; agent?: string; timeoutMs?: number }, signal?: AbortSignal) => startReview({ ctx, model: options.reviewModel, ...input, signal }),
    startPullRequestReview: (input: { cwd: string; repository: string; prNumber: number; agent?: string; timeoutMs?: number }, signal?: AbortSignal) => startPullRequestReview({ ctx, model: options.reviewModel, ...input, signal }),
    verifyPullRequestHeads,
    async watch(signal?: AbortSignal) {
      for await (const event of ctx.event.subscribe({ signal })) {
        if (["session.updated", "session.created", "session.deleted", "worktree.updated"].includes(event.type)) options.onInvalidate?.()
      }
    },
  }
}
