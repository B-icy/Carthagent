import { createTask, listTasks, reconcileTasks } from "../../../../lib/opencode/workspace.mjs"
import { exportLegacyTranscript, listLegacyArchive, readLegacyTranscript, searchLegacyArchive } from "../../../../lib/opencode/archive.mjs"
import { startReview, startPullRequestReview, verifyPullRequestHeads } from "../../../../lib/opencode/review.mjs"

type Context = {
  location: { project: { id: string; canonical: string } }
  worktree: { create(input: Record<string, unknown>): Promise<{ directory: string }> }
  session: {
    create(input: Record<string, unknown>): Promise<{ id: string }>
    prompt(input: Record<string, unknown>): Promise<unknown>
    wait(input: Record<string, unknown>): Promise<unknown>
    context(input: Record<string, unknown>): Promise<unknown[]>
    get(input: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<{ outcome?: "succeeded" | "failed" | "interrupted" }>
    interrupt(input: Record<string, unknown>): Promise<void>
  }
  agent: { list(): Promise<unknown> }
  event: { subscribe(options?: { signal?: AbortSignal }): AsyncIterable<{ type: string }> }
}

export type Orchestration = ReturnType<typeof registerOrchestration>

export type OrchestrationOptions = {
  legacyRoots?: string[]
  reviewModel?: { providerID: string; id: string; variant?: string }
  onInvalidate?: () => void
}

/** Domain surface used by the CTG native RPC registration; event streams only invalidate caches. */
export function registerOrchestration(ctx: Context, options: OrchestrationOptions = {}) {
  const canonical = ctx.location.project.canonical
  const projectID = ctx.location.project.id
  if (!canonical || !projectID) throw new Error("CTG orchestration requires the canonical project location and projectID")
  const legacyRoots = options.legacyRoots ?? []
  return {
    createTask: (input: { task: string; from?: string; branch?: string; model?: { providerID: string; id: string; variant?: string }; agent?: string; parentTaskID?: string | null }) => createTask({ ctx, canonical, projectID, ...input }),
    listTasks: (input?: { includeOperations?: boolean }) => listTasks({ canonical, ...input }),
    reconcile: (sessionIDs: string[]) => reconcileTasks({ canonical, sessionIDs }),
    archive: {
      list: () => listLegacyArchive({ roots: legacyRoots }),
      search: (query: string) => searchLegacyArchive({ roots: legacyRoots, query }),
      transcript: (path: string) => readLegacyTranscript({ path, roots: legacyRoots }),
      export: (path: string, format?: "json" | "jsonl") => exportLegacyTranscript({ path, format, roots: legacyRoots }),
    },
    startReview: (input: { cwd: string; identity?: string; agent?: string; timeoutMs?: number }, signal?: AbortSignal) => startReview({ ctx, model: options.reviewModel, ...input, signal }),
    startPullRequestReview: (input: { cwd: string; identity: string; localHead: string; remoteHead: string; pullRequestHead: string; source: string; readCurrent: () => Promise<{ localHead: string; remoteHead: string; pullRequestHead: string; source: string }>; agent?: string; timeoutMs?: number }, signal?: AbortSignal) => startPullRequestReview({ ctx, model: options.reviewModel, ...input, signal }),
    verifyPullRequestHeads,
    async watch(signal?: AbortSignal) {
      for await (const event of ctx.event.subscribe({ signal })) {
        if (["session.updated", "session.created", "session.deleted", "worktree.updated"].includes(event.type)) options.onInvalidate?.()
      }
    },
  }
}
