import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** @param {string} directory @returns {string[]} */
function walk(directory) {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    let stat;
    try { stat = lstatSync(path); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ELOOP') continue; throw error; }
    // Do not follow either directory or file symlinks while enumerating an archive.
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) files.push(...walk(path));
    else if (stat.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
  }
  return files;
}

function isWithin(root, path) {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === '' || (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot));
}

function canonicalRoots(roots = []) {
  return roots.flatMap(root => {
    try { return [realpathSync(resolve(root))]; }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []; throw error; }
  });
}

/** Open the real target only after checking both its canonical parent and final target.
 * O_NOFOLLOW prevents a final-component symlink swap between validation and open. */
function readContained(path, allowedRoots) {
  const lexical = resolve(path);
  let realParent;
  try { realParent = realpathSync(dirname(lexical)); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw error; throw Error('Legacy transcript parent is not accessible', { cause: error }); }
  let realTarget;
  try { realTarget = realpathSync(lexical); } catch (error) {
    if ((error.code === 'ENOENT' || error.code === 'ENOTDIR') && allowedRoots.some(root => isWithin(root, realParent))) throw error;
    throw Error('Legacy transcript path is outside configured archive roots or is not accessible', { cause: error });
  }
  if (!allowedRoots.some(root => isWithin(root, realParent) && isWithin(root, realTarget))) throw Error('Legacy transcript path is outside configured archive roots');
  const targetStat = statSync(realTarget);
  if (!realTarget.endsWith('.jsonl') || !targetStat.isFile()) throw Error('Legacy transcript must be a JSONL file');
  let fd;
  try {
    fd = openSync(realTarget, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const openedStat = fstatSync(fd);
    if (openedStat.dev !== targetStat.dev || openedStat.ino !== targetStat.ino) throw Error('Legacy transcript target changed while opening');
    return readFileSync(fd, 'utf8');
  } finally { if (fd !== undefined) closeSync(fd); }
}

/** @param {string} text @returns {{ rows: any[], malformed: Array<{ line: number }> }} */
function parse(text) {
  const rows = [];
  const malformed = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try { rows.push(JSON.parse(line)); } catch { malformed.push({ line: index + 1 }); }
  });
  return { rows, malformed };
}

/** @param {string} path @param {string[]} roots */
function sessionInfo(path, roots) {
  const canonical = realpathSync(path);
  const { rows, malformed } = parse(readContained(canonical, roots));
  const header = rows.find(row => row?.type === 'session') || rows[0] || {};
  const messages = rows.filter(row => row?.type === 'message');
  const text = messages.map(row => JSON.stringify(row.message ?? row)).join('\n');
  return { id: header.id || basename(path, '.jsonl'), path: canonical, root: roots.find(root => isWithin(root, canonical)) || null, createdAt: header.timestamp || null, messageCount: messages.length, malformedLines: malformed, searchText: text };
}

/** Enumerate legacy Pi transcripts only; this module never imports or mutates them. */
/** @param {{ roots: string[] }} options */
export function listLegacyArchive({ roots }) {
  if (!Array.isArray(roots)) throw Error('roots must be an array');
  const allowed = canonicalRoots(roots);
  const files = [...new Set(allowed.flatMap(root => walk(root)))].sort();
  return files.flatMap(path => {
    try { const info = sessionInfo(path, allowed); delete info.searchText; return [info]; }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ELOOP') return []; throw error; }
  });
}

/** @param {{ roots: string[], query: string }} options */
export function searchLegacyArchive({ roots, query }) {
  if (!Array.isArray(roots)) throw Error('roots must be an array');
  if (typeof query !== 'string' || !query.trim()) throw Error('Search query is required');
  const allowed = canonicalRoots(roots);
  const needle = query.toLocaleLowerCase();
  return [...new Set(allowed.flatMap(root => walk(root)))].sort().flatMap(path => {
    try {
      const session = sessionInfo(path, allowed);
      const index = session.searchText.toLocaleLowerCase().indexOf(needle);
      if (index < 0) return [];
      return [{ ...session, excerpt: session.searchText.slice(Math.max(0, index - 120), index + needle.length + 180) }];
    } catch (error) { if (error.code === 'ENOENT' || error.code === 'ELOOP') return []; throw error; }
  });
}

/** @param {{ path: string, roots?: string[] }} options */
export function readLegacyTranscript({ path, roots }) {
  if (!roots) throw Error('Configured archive roots are required to read a legacy transcript');
  const allowed = canonicalRoots(roots);
  const target = resolve(path);
  const content = readContained(target, allowed);
  const canonical = realpathSync(target);
  const { rows, malformed } = parse(content);
  return { path: canonical, records: rows, malformedLines: malformed };
}

/** @param {{ path: string, format?: 'json' | 'jsonl', roots?: string[] }} options */
export function exportLegacyTranscript({ path, format = 'json', roots }) {
  const transcript = readLegacyTranscript({ path, roots });
  if (format === 'json') return `${JSON.stringify(transcript.records, null, 2)}\n`;
  if (format !== 'jsonl') throw Error('Export format must be json or jsonl');
  return readContained(transcript.path, canonicalRoots(roots));
}
