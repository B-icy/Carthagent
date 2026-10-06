import { truncateTail, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createCodeIndex } from '../lib/codegraph.mjs';
import { queryCodeIndex } from '../lib/codegraph-query.mjs';

type CodeIndex = Awaited<ReturnType<typeof createCodeIndex>>;
export default function codegraph(pi: ExtensionAPI) {
  pi.registerFlag('codegraph-max-files', { description: 'Positive maximum source files indexed by code_nav (default 8000)', type: 'string', default: '8000' });
  const indexes = new Map<string, Promise<CodeIndex>>();
  const indexFor = (ctx: ExtensionContext) => {
    let pending = indexes.get(ctx.cwd);
    if (!pending) {
      const raw = pi.getFlag('codegraph-max-files') ?? '8000';
      if (!/^\d+$/.test(String(raw)) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) throw Error('codegraph-max-files must be a positive safe integer');
      pending = createCodeIndex(ctx.cwd, { maxFiles: Number(raw) });
      pending.catch(() => indexes.delete(ctx.cwd));
      indexes.set(ctx.cwd, pending);
    }
    return pending;
  };
  pi.registerTool({
    name: 'code_nav', label: 'Code navigation',
    description: 'Read-only structural graph for JS/TS/Python/Rust. Use definition/symbols/outline to locate code, callers/importers before changing APIs, then targeted source reads. Calls are name-based candidates, not resolved bindings. Results include coverage, total and nextOffset; page or filter incomplete answers. path filters definitions/symbols or caller call-site files; container filters enclosing classes.',
    parameters: { type: 'object', required: ['op'], additionalProperties: false, properties: {
      op: { type: 'string', enum: ['definition', 'symbols', 'callers', 'callees', 'imports', 'importers', 'outline', 'status'] },
      name: { type: 'string' }, path: { type: 'string' }, container: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 }, offset: { type: 'integer', minimum: 0, default: 0 },
    } },
    async execute(_id, params: { op: string; name?: string; path?: string; container?: string; limit?: number; offset?: number }, _signal: unknown, _update: unknown, ctx: ExtensionContext) {
      const index = await indexFor(ctx);
      await index.refresh();
      // Reduce the page instead of losing the completion metadata through truncation.
      let result = queryCodeIndex(index, params);
      let serialized = JSON.stringify(result);
      while (Buffer.byteLength(serialized) > 23000 && result.returned > 1) {
        result = queryCodeIndex(index, { ...params, limit: Math.max(1, Math.floor(result.returned / 2)) });
        serialized = JSON.stringify(result);
      }
      const output = truncateTail(serialized, { maxBytes: 24000, maxLines: 400 });
      return { content: [{ type: 'text' as const, text: output.content + (output.truncated ? '\n[Oversized record truncated; narrow query.]' : '') }], details: {} };
    },
  });
}
