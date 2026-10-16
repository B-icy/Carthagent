import { createCodeIndex } from "../../../../lib/codegraph.mjs"
import { boundedCodeNavResult } from "../../../../lib/codegraph-query.mjs"
import { resolve } from "node:path"

const schema = {
  type: "object", additionalProperties: false, required: ["op"],
  properties: {
    op: { type: "string", enum: ["definition", "symbols", "callers", "callees", "imports", "importers", "outline", "status"] },
    name: { type: "string" }, path: { type: "string" }, container: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 200, default: 50 }, offset: { type: "integer", minimum: 0, default: 0 },
  },
}
const result = (value: string) => ({ content: value })

/** Register the structural navigator in the OpenCode server tool registry. */
export async function registerCodegraph(ctx: any, options: { maxFiles?: number } = {}) {
  const indexes = new Map<string, Promise<Awaited<ReturnType<typeof createCodeIndex>>>>()
  const registration = await ctx.tool.transform((editor: any) => {
    editor.namespace?.({ name: "carthagent", description: "Carthagent code navigation" })
    editor.add({
      name: "code_nav", description: "Read-only structural graph for JS/TS/Python/Rust. Use definition/symbols/outline to locate code and callers/importers before changing APIs. Calls are name-based candidates, not resolved bindings. Results include coverage, total and nextOffset; page or filter incomplete answers.",
      input: schema, options: { codemode: true },
      execute: async (input: any, toolContext: any) => {
        const session = await ctx.session.get({ sessionID: toolContext.sessionID })
        const root = resolve(session.location.directory, session.subpath || ".")
        let index = indexes.get(root)
        if (!index) {
          const maxFiles = options.maxFiles ?? 8000
          if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) throw Error("codegraph maxFiles must be a positive safe integer")
          index = createCodeIndex(root, { maxFiles })
          index.catch(() => indexes.delete(root))
          indexes.set(root, index)
        }
        const current = await index
        await current.refresh()
        return result(boundedCodeNavResult(current, input))
      },
    })
  })
  return () => { indexes.clear(); return registration.dispose() }
}
