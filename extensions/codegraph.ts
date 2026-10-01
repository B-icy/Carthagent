import { truncateTail, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createCodeIndex } from '../lib/codegraph.mjs';

type CodeIndex = Awaited<ReturnType<typeof createCodeIndex>>;

const text = (value: unknown) => {
  const output = truncateTail(typeof value === 'string' ? value : JSON.stringify(value, null, 2), { maxBytes: 24000, maxLines: 400 });
  return { content: [{ type: 'text' as const, text: output.content + (output.truncated ? '\n[Output truncated; narrow the query.]' : '') }], details: {} };
};

const fmtDef = (d: { file: string; line: number; kind: string; container: string | null; name: string; displayName?: string }) =>
  `${d.file}:${d.line}  ${d.kind} ${d.displayName || (d.container ? `${d.container}.${d.name}` : d.name)}`;

const fmtCall = (c: { file: string; line: number; name?: string; caller: { name: string } | null }) =>
  `${c.file}:${c.line}  ${c.caller ? `${c.caller.name}()` : '<module>'}${c.name ? ` → ${c.name}()` : ''}`;

export default function codegraph(pi: ExtensionAPI) {
  pi.registerFlag('codegraph-max-files', { description: 'Maximum source files indexed by the code_nav structural graph (default 8000)', type: 'string', default: '0' });

  const indexes = new Map<string, Promise<CodeIndex>>();
  const indexFor = (ctx: ExtensionContext) => {
    let pending = indexes.get(ctx.cwd);
    if (!pending) {
      const maxFiles = Number(pi.getFlag('codegraph-max-files')) || 8000;
      pending = createCodeIndex(ctx.cwd, { maxFiles });
      pending.catch(() => indexes.delete(ctx.cwd));
      indexes.set(ctx.cwd, pending);
    }
    return pending;
  };

  pi.registerTool({
    name: 'code_nav',
    label: 'Code navigation',
    description: 'Deterministic structural code graph built from tree-sitter ASTs — NOT text search. Ops: definition (where is name defined), symbols (find symbol names containing query), callers (who calls name), callees (what name calls), imports (what a file imports), importers (who imports a file), outline (symbols in a file), status (index stats). Use callers/importers before changing a signature; use definition/outline to navigate. JS/TS/Python/Rust.',
    parameters: {
      type: 'object',
      required: ['op'],
      additionalProperties: false,
      properties: {
        op: { type: 'string', enum: ['definition', 'symbols', 'callers', 'callees', 'imports', 'importers', 'outline', 'status'] },
        name: { type: 'string', description: 'Symbol name for definition/callers/callees, or search substring for symbols' },
        path: { type: 'string', description: 'Workspace-relative file path for imports/importers/outline' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
    },
    async execute(_id, params: { op: string; name?: string; path?: string; limit?: number }, _signal: unknown, _update: unknown, ctx: ExtensionContext) {
      const index = await indexFor(ctx);
      await index.refresh();
      const limit = Math.min(Math.max(params.limit || 50, 1), 200);
      const name = params.name?.trim();
      const path = params.path?.trim();
      switch (params.op) {
        case 'status': {
          const s = index.stats();
          return text(`code_nav index: ${s.files} files, ${s.symbols} symbols, ${s.calls} call sites (${s.parsed} parsed in ${s.parseMs}ms${s.parseErrors ? `, ${s.parseErrors} parse errors` : ''}${s.skipped ? `, ${s.skipped} skipped` : ''})`);
        }
        case 'definition': {
          if (!name) throw new Error('definition requires name');
          const defs = index.definition(name);
          return text(defs.length ? defs.slice(0, limit).map(fmtDef).join('\n') : `no definitions of ${name}`);
        }
        case 'symbols': {
          if (!name) throw new Error('symbols requires name (a substring to match)');
          const defs = index.symbols(name, limit);
          return text(defs.length ? defs.map(fmtDef).join('\n') : `no symbols matching ${name}`);
        }
        case 'callers': {
          if (!name) throw new Error('callers requires name');
          const calls = index.callers(name).slice(0, limit);
          return text(calls.length ? calls.map(fmtCall).join('\n') : `no callers of ${name}`);
        }
        case 'callees': {
          if (!name) throw new Error('callees requires name');
          const calls = index.callees(name, path).slice(0, limit);
          return text(calls.length ? calls.map(fmtCall).join('\n') : `no calls inside ${name}`);
        }
        case 'imports': {
          if (!path) throw new Error('imports requires path');
          const specs = index.imports(path).slice(0, limit);
          return text(specs.length ? specs.join('\n') : `no imports found in ${path}`);
        }
        case 'importers': {
          if (!path) throw new Error('importers requires path');
          const rows = index.importers(path).slice(0, limit).map(r => `${r.file}  (via ${r.spec})`);
          return text(rows.length ? rows.join('\n') : `no file imports ${path}`);
        }
        case 'outline': {
          if (!path) throw new Error('outline requires path');
          const defs = index.outline(path).slice(0, limit);
          return text(defs.length ? defs.map(fmtDef).join('\n') : `no symbols in ${path}`);
        }
        default:
          throw new Error(`unknown op: ${params.op}`);
      }
    },
  });
}
