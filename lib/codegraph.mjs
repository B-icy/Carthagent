import { createRequire } from 'node:module';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, extname, resolve, dirname, isAbsolute } from 'node:path';

const require_ = createRequire(import.meta.url);

const LANG_BY_EXT = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.tsx': 'tsx',
  '.py': 'python',
  '.rs': 'rust',
};

const DEFAULT_IGNORES = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', 'target', 'vendor', '.venv', 'venv', '__pycache__',
  '.idea', '.vscode', '.turbo', '.cache', '.harness', 'release',
]);

// ---- per-language AST extraction -------------------------------------------
// Each spec: nameOf(node) → def name | null for def node types, callName(node)
// → callee name for call node types, importSpec(node) → specifier string.

const firstNamedOfType = (node, types) => {
  for (const child of node.namedChildren) if (types.includes(child.type)) return child;
  return null;
};

const fieldName = node => node.childForFieldName('name');
const lastNamedChild = node => node.namedChildren[node.namedChildren.length - 1] || null;

const jsSpec = {
  defTypes: new Set(['function_declaration', 'generator_function_declaration', 'class_declaration',
    'abstract_class_declaration', 'interface_declaration', 'type_alias_declaration',
    'enum_declaration', 'method_definition']),
  nameOf(node) {
    const named = fieldName(node);
    return named?.text || firstNamedOfType(node, ['identifier', 'type_identifier', 'property_identifier'])?.text || null;
  },
  defKind: node => node.type === 'method_definition' ? 'method'
    : node.type.includes('class') ? 'class'
      : node.type === 'interface_declaration' ? 'interface'
        : node.type === 'type_alias_declaration' ? 'type'
          : node.type === 'enum_declaration' ? 'enum' : 'function',
  containerTypes: new Set(['class_declaration', 'abstract_class_declaration']),
  isDef(node, parent) {
    if (this.defTypes.has(node.type)) return true;
    // const/let x = () => ... or = function ...
    if (node.type === 'variable_declarator') {
      const value = node.childForFieldName('value');
      return !!value && ['arrow_function', 'function_expression', 'generator_function'].includes(value.type);
    }
    return false;
  },
  defName(node) {
    if (node.type === 'variable_declarator') return node.childForFieldName('name')?.text || null;
    return this.nameOf(node);
  },
  callTypes: new Set(['call_expression']),
  callName(node) {
    const fn = node.childForFieldName('function');
    if (!fn) return null;
    if (fn.type === 'identifier') return fn.text;
    if (fn.type === 'member_expression') return fn.childForFieldName('property')?.text || null;
    return null;
  },
  importTypes: new Set(['import_statement']),
  importSpec(node) {
    const src = node.childForFieldName('source') || firstNamedOfType(node, ['string']);
    return src ? src.text.replace(/^['"`]|['"`]$/g, '') : null;
  },
  // require('x') as an import edge
  extraImport(node) {
    if (node.type !== 'call_expression') return null;
    const fn = node.childForFieldName('function');
    if (fn?.type !== 'identifier' || fn.text !== 'require') return null;
    const arg = node.childForFieldName('arguments')?.namedChildren[0];
    return arg?.type === 'string' ? arg.text.replace(/^['"`]|['"`]$/g, '') : null;
  },
};

const pySpec = {
  defTypes: new Set(['function_definition', 'class_definition']),
  nameOf(node) { return firstNamedOfType(node, ['identifier'])?.text || null; },
  defKind: node => node.type === 'class_definition' ? 'class' : 'function',
  containerTypes: new Set(['class_definition']),
  isDef(node) { return this.defTypes.has(node.type); },
  defName(node) { return this.nameOf(node); },
  callTypes: new Set(['call']),
  callName(node) {
    const fn = node.childForFieldName('function');
    if (!fn) return null;
    if (fn.type === 'identifier') return fn.text;
    if (fn.type === 'attribute') return lastNamedChild(fn)?.text || null;
    return null;
  },
  importTypes: new Set(['import_statement', 'import_from_statement']),
  importSpec(node) {
    const module = node.type === 'import_from_statement'
      ? (node.childForFieldName('module_name') || firstNamedOfType(node, ['dotted_name', 'relative_import']))
      : firstNamedOfType(node, ['dotted_name', 'aliased_import']);
    if (!module) return null;
    const aliased = module.type === 'aliased_import' ? firstNamedOfType(module, ['dotted_name']) : module;
    return aliased?.text || null;
  },
  extraImport() { return null; },
};

const rustSpec = {
  defTypes: new Set(['function_item', 'struct_item', 'enum_item', 'union_item', 'trait_item',
    'type_item', 'const_item', 'static_item', 'mod_item', 'macro_definition']),
  nameOf(node) { return firstNamedOfType(node, ['identifier', 'type_identifier'])?.text || null; },
  defKind: node => node.type === 'function_item' ? 'function'
    : node.type === 'struct_item' ? 'struct'
      : node.type === 'enum_item' ? 'enum'
        : node.type === 'trait_item' ? 'trait'
          : node.type === 'mod_item' ? 'module' : 'item',
  containerTypes: new Set(['impl_item', 'trait_item', 'mod_item']),
  containerOf(node) { return firstNamedOfType(node, ['type_identifier', 'identifier'])?.text || null; },
  isDef(node) { return this.defTypes.has(node.type); },
  defName(node) { return this.nameOf(node); },
  callTypes: new Set(['call_expression', 'macro_invocation']),
  callName(node) {
    if (node.type === 'macro_invocation') {
      const macro = node.childForFieldName('macro') || firstNamedOfType(node, ['identifier', 'scoped_identifier']);
      return macro ? `${macro.text.split('::').pop()}!` : null;
    }
    const fn = node.childForFieldName('function');
    if (!fn) return null;
    if (fn.type === 'identifier') return fn.text;
    if (fn.type === 'field_expression') return fn.childForFieldName('field')?.text || null;
    if (fn.type === 'scoped_identifier' || fn.type === 'generic_function') return lastNamedChild(fn)?.text || fn.text.split('::').pop();
    return null;
  },
  importTypes: new Set(['use_declaration']),
  importSpec(node) {
    const arg = firstNamedOfType(node, ['scoped_identifier', 'identifier', 'use_list', 'scoped_use_list', 'use_as_clause']);
    return arg ? arg.text : node.text.replace(/^use\s+/, '').replace(/;$/, '').trim() || null;
  },
  extraImport() { return null; },
};

const SPECS = { javascript: jsSpec, typescript: jsSpec, tsx: jsSpec, python: pySpec, rust: rustSpec };

// ---- parser bootstrap --------------------------------------------------------
// Dependency pin constraint: the tree-sitter-wasms grammars ship the pre-`dylink.0`
// wasm section, which only web-tree-sitter ≤0.22.x accepts. Bump both together.

let runtimePromise = null;
const parsers = new Map(); // lang -> dedicated parser (setLanguage once; concurrent parses never share)

async function parserFor(lang) {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const Parser = require_('web-tree-sitter');
      await Parser.init();
      const wasmDir = require_.resolve('tree-sitter-wasms/package.json').replace(/package\.json$/, 'out');
      const languages = new Map();
      const load = async name => {
        if (!languages.has(name)) languages.set(name, await Parser.Language.load(join(wasmDir, `tree-sitter-${name}.wasm`)));
        return languages.get(name);
      };
      return { Parser, load };
    })();
  }
  const { Parser, load } = await runtimePromise;
  if (!parsers.has(lang)) {
    const parser = new Parser();
    parser.setLanguage(await load(lang));
    parsers.set(lang, parser);
  }
  return parsers.get(lang);
}

// ---- index -------------------------------------------------------------------

/**
 * Create a structural index over a workspace. The index is per-process;
 * `refresh()` re-parses only files whose mtime/size changed since last scan.
 */
export async function createCodeIndex(root, { maxFiles = 8000, maxBytes = 1_048_576, ignores = DEFAULT_IGNORES } = {}) {
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw Error('Index limits must be positive safe integers');
  const base = resolve(root);
  const toRel = abs => relative(base, abs).replace(/\\/g, '/'); // index keys always POSIX-style
  const files = new Map(); // relPath -> { mtimeMs, size, defs, calls, imports }
  const defIndex = new Map(); // name -> [{file, line, kind, container}]
  const callIndex = new Map(); // calleeName -> [{file, line, caller:{name,file,line}|null}]
  const importEdges = new Map(); // file -> [spec]
  const stats = { files: 0, symbols: 0, calls: 0, parsed: 0, parseErrors: 0, totalParseErrors: 0, parseMs: 0, skipped: 0, unreadable: 0, discovered: 0, complete: true };

  const dropFile = rel => {
    const prev = files.get(rel);
    if (!prev) return;
    for (const d of prev.defs) {
      for (const key of d.keys) {
        const list = defIndex.get(key);
        if (list) { const i = list.findIndex(x => x.file === rel && x.line === d.line); if (i >= 0) list.splice(i, 1); if (!list.length) defIndex.delete(key); }
      }
      stats.symbols--;
    }
    for (const c of prev.calls) {
      const list = callIndex.get(c.name);
      if (list) { const i = list.findIndex(x => x.file === rel && x.line === c.line); if (i >= 0) list.splice(i, 1); if (!list.length) callIndex.delete(c.name); }
      stats.calls--;
    }
    files.delete(rel);
    importEdges.delete(rel);
  };

  const addDef = (rel, { name, kind, line, container }) => {
    const keys = [name];
    if (container) keys.push(`${container}.${name}`);
    for (const key of keys) {
      if (!defIndex.has(key)) defIndex.set(key, []);
      defIndex.get(key).push({ file: rel, line, kind, container: container || null, name });
    }
    stats.symbols++;
    return { name, kind, line, container: container || null, keys };
  };

  const extract = (tree, rel, spec) => {
    const entry = { defs: [], calls: [], imports: [] };
    const visit = (node, enclosing, container) => {
      if (spec.isDef(node)) {
        const name = spec.defName(node);
        if (name) {
          entry.defs.push(addDef(rel, { name, kind: spec.defKind(node), line: node.startPosition.row + 1, container }));
          enclosing = { name, line: node.startPosition.row + 1, container: container || null };
        }
        if (spec.containerTypes.has(node.type)) container = spec.containerOf ? spec.containerOf(node) : name;
      } else if (spec.containerTypes.has(node.type)) {
        container = spec.containerOf ? spec.containerOf(node) : (spec.nameOf(node) || container);
      }
      if (spec.callTypes.has(node.type)) {
        const name = spec.callName(node);
        if (name) {
          entry.calls.push({ name, line: node.startPosition.row + 1, caller: enclosing ? { ...enclosing, file: rel } : null });
          if (!callIndex.has(name)) callIndex.set(name, []);
          callIndex.get(name).push({ file: rel, line: node.startPosition.row + 1, caller: enclosing ? { ...enclosing, file: rel } : null });
          stats.calls++;
        }
      }
      if (spec.importTypes.has(node.type)) {
        const specText = spec.importSpec(node);
        if (specText) entry.imports.push(specText);
      }
      const extra = spec.extraImport(node);
      if (extra) entry.imports.push(extra);
      for (const child of node.namedChildren) visit(child, enclosing, container);
    };
    visit(tree.rootNode, null, null);
    return entry;
  };

  const parseFile = async (abs, rel, lang, stat) => {
    const source = readFileSync(abs, 'utf8');
    const parser = await parserFor(lang);
    const started = Date.now();
    const tree = parser.parse(source);
    stats.parseMs += Date.now() - started;
    stats.parsed++;
    const entry = extract(tree, rel, SPECS[lang]);
    files.set(rel, { mtimeMs: stat.mtimeMs, size: stat.size, defs: entry.defs, calls: entry.calls, imports: entry.imports });
    importEdges.set(rel, entry.imports);
    tree.delete();
  };

  const scan = (dir, out) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { stats.unreadable++; return; }
    for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name.startsWith('.') || ignores.has(ent.name)) continue;
        scan(abs, out);
      } else if (ent.isFile()) {
        const lang = LANG_BY_EXT[extname(ent.name)];
        if (lang) out.push({ abs, lang });
      }
    }
  };

  const doRefresh = async () => {
    const found = [];
    stats.unreadable = 0;
    scan(base, found);
    stats.skipped = 0;
    stats.parseErrors = 0;
    stats.discovered = found.length;
    if (found.length > maxFiles) { stats.skipped += found.length - maxFiles; found.length = maxFiles; }
    const seen = new Set();
    for (const { abs, lang } of found) {
      const rel = toRel(abs);
      seen.add(rel);
      let stat;
      try { stat = statSync(abs); } catch { dropFile(rel); stats.unreadable++; continue; }
      if (stat.size > maxBytes) { dropFile(rel); stats.skipped++; continue; }
      const prev = files.get(rel);
      if (prev && prev.mtimeMs === stat.mtimeMs && prev.size === stat.size) continue;
      dropFile(rel);
      try { await parseFile(abs, rel, lang, stat); } catch { stats.parseErrors++; stats.totalParseErrors++; }
    }
    for (const rel of [...files.keys()]) if (!seen.has(rel)) dropFile(rel);
    stats.files = files.size;
    stats.complete = stats.skipped === 0 && stats.parseErrors === 0 && stats.unreadable === 0;
    return stats;
  };

  const resolveImport = (fromFile, spec) => {
    // Relative specifiers resolve to a repo file; bare specifiers stay as-is.
    if (!spec.startsWith('.') && !spec.startsWith('/')) return null;
    const stem = resolve(dirname(join(base, fromFile)), spec);
    const rel = toRel(stem);
    const candidates = [rel, ...Object.keys(LANG_BY_EXT).map(e => rel + e), `${rel}/index.ts`, `${rel}/index.tsx`, `${rel}/index.js`, `${rel}/__init__.py`, `${rel}/mod.rs`];
    return candidates.find(c => files.has(c)) || null;
  };

  // Serialize refresh calls: overlapping refreshes would interleave dropFile/parseFile.
  let refreshQueue = Promise.resolve();
  const refresh = () => (refreshQueue = refreshQueue.then(doRefresh, doRefresh));

  await refresh();

  return {
    root: base,
    refresh,
    stats: () => ({ ...stats }),
    definition(name) {
      return defIndex.get(name) || [];
    },
    symbols(query, limit = Infinity) {
      const q = String(query || '').toLowerCase();
      const out = [];
      for (const [name, defs] of defIndex) {
        if (!name.toLowerCase().includes(q)) continue;
        for (const d of defs) out.push({ ...d, displayName: name });
        if (out.length >= limit) break;
      }
      return out.slice(0, limit);
    },
    callers(name) { return callIndex.get(name) || []; },
    callees(name, file) {
      return (defIndex.get(name) || [])
        .filter(d => !file || d.file === file)
        .flatMap(def => collectCallsOf(def, def.name));
    },
    imports(file) { return files.get(file)?.imports || files.get(normalizeRel(file))?.imports || []; },
    importers(file) {
      const rel = normalizeRel(file);
      const out = [];
      for (const [f, specs] of importEdges) {
        for (const spec of specs) {
          if (resolveImport(f, spec) === rel || (!resolveImport(f, spec) && spec === rel)) { out.push({ file: f, spec }); break; }
        }
      }
      return out;
    },
    outline(file) {
      const rel = normalizeRel(file);
      return (files.get(rel)?.defs || []).map(({ keys, ...d }) => d);
    },
  };

  function normalizeRel(file) {
    const s = String(file || '').replace(/^\.\//, '');
    return (isAbsolute(s) ? toRel(s) : s).replace(/\\/g, '/');
  }

  function collectCallsOf(def, name) {
    // calls made inside the def at def.file:def.line
    const entry = files.get(def.file);
    if (!entry) return [];
    return entry.calls
      .filter(c => c.caller && c.caller.name === name && c.caller.line === def.line && c.caller.file === def.file)
      .map(c => ({ ...c, callerDef: def }));
  }
}
