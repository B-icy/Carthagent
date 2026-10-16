import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

function walk(directory) {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
  }
  return files;
}

function parse(path) {
  const rows = [];
  const malformed = [];
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try { rows.push(JSON.parse(line)); } catch { malformed.push({ line: index + 1 }); }
  });
  return { rows, malformed };
}

function sessionInfo(path, roots) {
  const { rows, malformed } = parse(path);
  const header = rows.find(row => row?.type === 'session') || rows[0] || {};
  const messages = rows.filter(row => row?.type === 'message');
  const text = messages.map(row => JSON.stringify(row.message ?? row)).join('\n');
  return { id: header.id || basename(path, '.jsonl'), path, root: roots.find(root => path.startsWith(`${resolve(root)}/`)) || null, createdAt: header.timestamp || null, messageCount: messages.length, malformedLines: malformed, searchText: text };
}

/** Enumerate legacy Pi transcripts only; this module never imports or mutates them. */
export function listLegacyArchive({ roots }) {
  if (!Array.isArray(roots)) throw Error('roots must be an array');
  const files = [...new Set(roots.flatMap(root => walk(resolve(root))))].sort();
  return files.map(path => {
    const info = sessionInfo(path, roots);
    delete info.searchText;
    return info;
  });
}

export function searchLegacyArchive({ roots, query }) {
  if (typeof query !== 'string' || !query.trim()) throw Error('Search query is required');
  const needle = query.toLocaleLowerCase();
  return [...new Set(roots.flatMap(root => walk(resolve(root))))].sort().flatMap(path => {
    const session = sessionInfo(path, roots);
    const index = session.searchText.toLocaleLowerCase().indexOf(needle);
    if (index < 0) return [];
    return [{ ...session, excerpt: session.searchText.slice(Math.max(0, index - 120), index + needle.length + 180) }];
  });
}

export function readLegacyTranscript({ path, roots }) {
  const target = resolve(path);
  if (roots && !roots.some(root => target.startsWith(`${resolve(root)}/`))) throw Error('Legacy transcript path is outside configured archive roots');
  if (!target.endsWith('.jsonl') || !statSync(target).isFile()) throw Error('Legacy transcript must be a JSONL file');
  const { rows, malformed } = parse(target);
  return { path: target, records: rows, malformedLines: malformed };
}

export function exportLegacyTranscript({ path, format = 'json', roots }) {
  const transcript = readLegacyTranscript({ path, roots });
  if (format === 'json') return `${JSON.stringify(transcript.records, null, 2)}\n`;
  if (format !== 'jsonl') throw Error('Export format must be json or jsonl');
  return readFileSync(transcript.path, 'utf8');
}
