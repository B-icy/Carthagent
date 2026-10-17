import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { Context } from '@opencode/plugin/promise/plugin';
import { exportLegacyTranscript, readLegacyTranscript } from '../../../../lib/opencode/archive.mjs';
import { Archive } from '../archive-rpc';

const MAX_FILE_BYTES = 4_000_000;
const MAX_FILES = 2_000;
const MAX_TOTAL_BYTES = 50_000_000;
const MAX_PAGE = 100;
const MAX_DIAGNOSTICS = 1000;

type Options = { archiveRoots?: string[]; archiveDir?: string };
type FileInfo = { path: string; token: string };
type LegacyRow = { type?: string; timestamp?: unknown; message?: unknown };
type ArchiveItem = { path: string; createdAt?: unknown; messageCount: number; malformedLines: Array<{ line: number }>; excerpt?: string };
const inside = (root: string, path: string) => path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

function rootsFrom(options: Options): string[] {
  const configured = options.archiveRoots ?? (options.archiveDir ? [options.archiveDir] : undefined);
  const roots = configured ?? [join(homedir(), '.carthagent', 'agent', 'sessions')];
  if (!Array.isArray(roots) || roots.some(root => typeof root !== 'string' || !root || !resolve(root))) throw new Error('Archive roots must be absolute filesystem paths configured by the host');
  if (roots.some(root => !root.startsWith(sep) || resolve(root) !== root)) throw new Error('Archive roots must be normalized absolute paths');
  return [...new Set(roots.map(root => {
    try { return realpathSync(root); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return root;
      throw new Error('Unable to resolve a configured archive root');
    }
  }))];
}

function files(roots: string[]): FileInfo[] {
  let totalBytes = 0;
  const found: FileInfo[] = [];
  const walk = (root: string, directory: string) => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw new Error('Unable to enumerate configured archive root'); }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(root, path);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const metadata = lstatSync(path);
        if (!metadata.isFile()) continue;
        if (metadata.size > MAX_FILE_BYTES) throw new Error(`Archive transcript exceeds ${MAX_FILE_BYTES} byte limit`);
        totalBytes += metadata.size;
        if (found.length >= MAX_FILES || totalBytes > MAX_TOTAL_BYTES) throw new Error('Configured archive exceeds the bounded scan limit');
        const canonical = realpathSync(path);
        if (!inside(root, canonical)) continue;
        const token = createHash('sha256').update(root).update('\0').update(canonical).digest('hex');
        found.push({ path: canonical, token });
      }
    }
  };
  for (const root of roots) {
    try { if (statSync(root).isDirectory()) walk(root, root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return found.sort((a, b) => a.token.localeCompare(b.token));
}

function pageArgs(input: { offset?: number; limit?: number }) {
  const offset = input.offset ?? 0;
  const size = input.limit ?? MAX_PAGE;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error('Archive offset must be between 0 and 1000000');
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PAGE) throw new Error(`Archive page limit must be between 1 and ${MAX_PAGE}`);
  return { offset, limit: size };
}

function boundedItems(result: ArchiveItem[], indexed: FileInfo[], offset: number, limit: number, total: number) {
  const pathToToken = new Map(indexed.map(file => [file.path, file.token]));
  return { items: result.slice(offset, offset + limit).map(record => ({
    id: pathToToken.get(record.path)!, createdAt: record.createdAt ?? null,
    messageCount: record.messageCount, malformedLines: record.malformedLines,
    ...(typeof record.excerpt === 'string' ? { excerpt: record.excerpt.slice(0, 400) } : {}), archiveOnly: true,
  })), total, offset, limit };
}

function projected(indexed: FileInfo[], roots: string[]) {
  return indexed.map(file => {
    const transcript = readFile(file, roots);
    const records = transcript.records as LegacyRow[];
    const header = records.find(row => row?.type === 'session') ?? records[0] ?? {};
    const messages = records.filter(row => row?.type === 'message');
    return {
      path: file.path,
      id: file.token,
      createdAt: header.timestamp ?? null,
      messageCount: messages.length,
      malformedLines: transcript.malformedLines.slice(0, MAX_DIAGNOSTICS),
      moreMalformedLines: transcript.malformedLines.length > MAX_DIAGNOSTICS,
      searchText: messages.map(row => JSON.stringify(row.message ?? row)).join('\n'),
    };
  });
}

function readFile(file: FileInfo, roots: string[]) {
  let canonical: string;
  try { canonical = realpathSync(file.path); }
  catch { throw new Error('Archive transcript is no longer available'); }
  if (canonical !== file.path || !roots.some(root => inside(root, canonical))) throw new Error('Archive transcript changed outside its configured root');
  return readLegacyTranscript({ path: canonical, roots });
}

/** Registers a read-only view of configured legacy transcript roots. */
export async function registerArchive(ctx: Context, options: Options = {}) {
  const roots = rootsFrom(options);
  const registration = await ctx.rpc.register(Archive, {
    list: async (input, call) => {
      call.signal.throwIfAborted();
      const { offset, limit } = pageArgs(input as { offset?: number; limit?: number });
      const indexed = files(roots);
      const listed = projected(indexed, roots);
      call.signal.throwIfAborted();
      return boundedItems(listed, indexed, offset, limit, listed.length);
    },
    search: async (input, call) => {
      call.signal.throwIfAborted();
      const { query, ...paging } = input as { query: string; offset?: number; limit?: number };
      if (!query.trim() || query.length > 200) throw new Error('Archive search query must contain 1 to 200 characters');
      const { offset, limit } = pageArgs(paging);
      const indexed = files(roots);
      const needle = query.toLocaleLowerCase();
      const matches = projected(indexed, roots).flatMap(record => {
        const index = record.searchText.toLocaleLowerCase().indexOf(needle);
        return index < 0 ? [] : [{ ...record, excerpt: record.searchText.slice(Math.max(0, index - 120), index + needle.length + 180) }];
      });
      call.signal.throwIfAborted();
      return boundedItems(matches, indexed, offset, limit, matches.length);
    },
    read: async (input, call) => {
      call.signal.throwIfAborted();
      const { id } = input as { id: string };
      const indexed = files(roots);
      const file = indexed.find(candidate => candidate.token === id);
      if (!file) throw new Error('Archive transcript ID was not found in configured roots');
      const result = readFile(file, roots);
      call.signal.throwIfAborted();
      if (JSON.stringify(result.records).length > MAX_FILE_BYTES) throw new Error('Archive transcript response exceeds the 4,000,000 character limit');
      return { id, records: result.records, malformedLines: result.malformedLines.slice(0, MAX_DIAGNOSTICS), moreMalformedLines: result.malformedLines.length > MAX_DIAGNOSTICS, archiveOnly: true };
    },
    export: async (input, call) => {
      call.signal.throwIfAborted();
      const { id, format = 'json' } = input as { id: string; format?: 'json' | 'jsonl' };
      const file = files(roots).find(candidate => candidate.token === id);
      if (!file) throw new Error('Archive transcript ID was not found in configured roots');
      if (realpathSync(file.path) !== file.path || !roots.some(root => inside(root, file.path))) throw new Error('Archive transcript changed outside its configured root');
      const content = exportLegacyTranscript({ path: file.path, format, roots });
      call.signal.throwIfAborted();
      if (content.length > MAX_FILE_BYTES) throw new Error('Archive export exceeds the 4,000,000 character response limit');
      return { id, format, content, archiveOnly: true };
    },
  });
  return () => registration.dispose();
}
