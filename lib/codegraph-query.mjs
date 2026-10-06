import { isAbsolute, relative } from 'node:path';
import { existsSync, statSync } from 'node:fs';
// Bounded presentation of structural candidates, never runtime-resolution proof.
export function queryCodeIndex(index, { op, name, path, container, limit = 50, offset = 0 }) {
  const stats = index.stats();
  if (op === 'status') return { op, coverage: stats };
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) throw Error('limit must be 1–200 and offset nonnegative');
  name = name?.trim(); path = path?.replaceAll('\\', '/').replace(/^\.\//, '').trim();
  if (path && isAbsolute(path)) {
    if (existsSync(path) && statSync(path).isDirectory()) throw Error('path is a directory; omit path for repository symbol search. outline/imports need a source FILE. Use find/ls to locate files.');
    path = relative(index.root, path).replaceAll('\\', '/');
    if (path.startsWith('../')) throw Error('path must be inside the indexed workspace');
  }
  if (path && existsSync(`${index.root}/${path}`) && statSync(`${index.root}/${path}`).isDirectory()) throw Error('path is a directory; omit path for symbol search, or supply a source file for outline/imports');
  let rows;
  if (['definition', 'symbols', 'callers', 'callees'].includes(op) && !name) throw Error(`${op} requires name`);
  if (['imports', 'importers', 'outline'].includes(op) && !path) throw Error(`${op} requires path`);
  switch (op) {
    case 'definition': rows = index.definition(name); break;
    case 'symbols': rows = index.symbols(name); break;
    case 'callers': rows = index.callers(name); break;
    case 'callees': rows = index.callees(name, path); break;
    case 'imports': rows = index.imports(path); break;
    case 'importers': rows = index.importers(path); break;
    case 'outline': rows = index.outline(path); break;
    default: throw Error(`unknown op: ${op}`);
  }
  if (path && ['definition', 'symbols', 'callers'].includes(op)) rows = rows.filter(row => row.file === path);
  if (container) rows = rows.filter(row => (op === 'callers' ? row.caller?.container : op === 'callees' ? row.callerDef?.container : row.container) === container);
  const total = rows.length;
  const results = rows.slice(offset, offset + limit);
  const nextOffset = offset + results.length < total ? offset + results.length : null;
  return { op, results, returned: results.length, total, offset, truncated: nextOffset !== null,
    next: total === 0 ? 'No indexed matches. Use find/ls to locate a source file, outline that file, or remove path/container filters. grep handles strings and unsupported syntax.' : undefined,
    nextOffset, coverage: { files: stats.files, discovered: stats.discovered, skipped: stats.skipped, parseErrors: stats.parseErrors, complete: stats.complete },
    semantics: ['callers', 'callees'].includes(op) ? 'Name-based structural candidates, not resolved runtime bindings. path filters call-site files for callers; container filters the enclosing caller.' : 'Indexed syntax only; excluded, unsupported and skipped files are outside coverage.' };
}
