import type { Context } from "@opencode/plugin/promise/plugin"
import { registerCodegraph } from "./codegraph.ts"
import { registerDelivery } from "./delivery.ts"

/** Optional production composition surface for a parent-owned plugin entrypoint. */
export async function registerNativeDelivery(ctx: Context, options: Parameters<typeof registerDelivery>[1] = {}) {
  const cleanups: Array<() => Promise<void>> = []
  try {
    cleanups.push(await registerDelivery(ctx, options))
    cleanups.push(await registerCodegraph(ctx, { maxFiles: typeof options.codegraphMaxFiles === "number" ? options.codegraphMaxFiles : undefined }))
  } catch (error) {
    const failures = await Promise.allSettled(cleanups.reverse().map(cleanup => cleanup()))
    const cleanupErrors = failures.filter((result): result is PromiseRejectedResult => result.status === "rejected").map(result => result.reason)
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "Native delivery registration failed and cleanup was incomplete.")
    throw error
  }
  return async () => {
    const failures: unknown[] = []
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, "Native delivery cleanup was incomplete.")
  }
}
