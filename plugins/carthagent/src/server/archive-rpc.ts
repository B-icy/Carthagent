import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, opendir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Context } from '@opencode/plugin/promise/plugin';
import { Archive } from '../archive-rpc';

const MAX_FILE_BYTES = 4_000_000;
const MAX_FILES = 2_000;
const MAX_ENTRIES = 10_000;
const MAX_TOTAL_BYTES = 50_000_000;
const MAX_PAGE = 100;
const MAX_DIAGNOSTICS = 1000;
const MAX_RECORDS = 10_000;
const MAX_SCAN_RECORDS = 100_000;
const READ_CHUNK = 64 * 1024;

type Options = { archiveRoots?: string[]; archiveDir?: string };
type FileInfo = { path: string; root: string; id: string; size: number };
type Row = { type?: string; timestamp?: unknown; message?: unknown; [key: string]: unknown };
type Parsed = { records: Row[]; malformedLines: Array<{ line: number }>; moreMalformedLines: boolean; recordsBytes: number; recordCount: number };
type ArchiveItem = { path: string; id: string; createdAt: unknown; messageCount: number; malformedLines: Array<{ line: number }>; moreMalformedLines: boolean; searchText: string; excerpt?: string };
type FailureCode = 'invalid_request' | 'not_found' | 'limit_exceeded' | 'archive_io';
class ArchiveFailure extends Error {
  constructor(readonly code: FailureCode, message: string) { super(message); }
}

function inside(root: string, path: string) {
  const fromRoot = relative(root, path);
  return fromRoot === '' || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

async function rootsFrom(options: Options): Promise<string[]> {
  const configured = options.archiveRoots ?? (options.archiveDir ? [options.archiveDir] : undefined);
  const roots = configured ?? [join(homedir(), '.carthagent', 'agent', 'sessions')];
  if (!Array.isArray(roots) || roots.some(root => typeof root !== 'string' || !isAbsolute(root) || resolve(root) !== root)) {
    throw new ArchiveFailure('invalid_request', 'Archive roots must be normalized absolute paths configured by the host');
  }
  const canonicalRoots: string[] = [];
  for (const root of roots) {
    try { canonicalRoots.push(await realpath(root)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') canonicalRoots.push(root);
      else throw new ArchiveFailure('archive_io', 'Unable to resolve a configured archive root');
    }
  }
  return [...new Set(canonicalRoots)];
}

function aborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException('Operation aborted', 'AbortError');
}

function sameFile(
  left: NonNullable<Awaited<ReturnType<import('node:fs/promises').FileHandle['stat']>>>,
  right: NonNullable<Awaited<ReturnType<import('node:fs/promises').FileHandle['stat']>>>,
) {
  return left.dev === right.dev && left.ino === right.ino;
}

/** Bind path containment and opened descriptor identity before any bytes are consumed. */
export async function verifyOpenedTarget(file: Pick<FileInfo, 'path' | 'root'>, handle: Awaited<ReturnType<typeof open>>) {
  let canonical: string;
  let pathStat;
  let descriptorStat;
  try {
    [canonical, pathStat, descriptorStat] = await Promise.all([realpath(file.path), stat(file.path), handle.stat()]);
  } catch {
    throw new ArchiveFailure('not_found', 'Archive transcript changed while opening');
  }
  if (!inside(file.root, canonical) || canonical !== file.path || !pathStat.isFile() || !descriptorStat.isFile() || !sameFile(pathStat, descriptorStat)) {
    throw new ArchiveFailure('not_found', 'Archive transcript target changed outside its configured root');
  }
  return descriptorStat;
}

async function enumerate(roots: string[], signal: AbortSignal): Promise<FileInfo[]> {
  let entriesSeen = 0;
  let totalBytes = 0;
  const found: FileInfo[] = [];
  for (const root of roots) {
    aborted(signal);
    let metadata;
    try { metadata = await stat(root); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new ArchiveFailure('archive_io', 'Unable to inspect a configured archive root');
    }
    if (!metadata.isDirectory()) continue;
    const pending = [root];
    while (pending.length) {
      aborted(signal);
      const directoryPath = pending.pop()!;
      let canonicalDirectory: string;
      try { canonicalDirectory = await realpath(directoryPath); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw new ArchiveFailure('archive_io', 'Unable to resolve an archive directory');
      }
      if (!inside(root, canonicalDirectory)) continue;
      let directory;
      try { directory = await opendir(directoryPath); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw new ArchiveFailure('archive_io', 'Unable to enumerate a configured archive root');
      }
      for await (const entry of directory) {
        aborted(signal);
        entriesSeen++;
        if (entriesSeen > MAX_ENTRIES) throw new ArchiveFailure('limit_exceeded', `Archive exceeds the ${MAX_ENTRIES} entry scan limit`);
        if (entry.isSymbolicLink()) continue;
        const path = join(directoryPath, entry.name);
        if (entry.isDirectory()) { pending.push(path); continue; }
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        if (found.length >= MAX_FILES) throw new ArchiveFailure('limit_exceeded', `Archive exceeds the ${MAX_FILES} transcript scan limit`);
        let canonical;
        try { canonical = await realpath(path); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw new ArchiveFailure('archive_io', 'Unable to resolve an archive transcript');
        }
        if (!inside(root, canonical)) continue;
        const id = createHash('sha256').update(root).update('\0').update(canonical).digest('hex');
        // Do not trust Dirent or pathname stat sizes. The descriptor is fstat'd
        // immediately before reading and the reader independently enforces cap.
        found.push({ path: canonical, root, id, size: -1 });
      }
    }
  }
  found.sort((a, b) => a.id.localeCompare(b.id));
  // Cheap bounded admission accounting uses descriptor metadata, not stat(path).
  for (const file of found) {
    aborted(signal);
    const handle = await openReadHandle(file.path);
    try {
      const info = await verifyOpenedTarget(file, handle);
      if (!info.isFile()) continue;
      if (info.size > MAX_FILE_BYTES) throw new ArchiveFailure('limit_exceeded', `Archive transcript exceeds the ${MAX_FILE_BYTES} byte limit`);
      totalBytes += info.size;
      if (totalBytes > MAX_TOTAL_BYTES) throw new ArchiveFailure('limit_exceeded', `Archive exceeds the ${MAX_TOTAL_BYTES} byte scan limit`);
      file.size = info.size;
    } finally { await handle.close(); }
  }
  return found.filter(file => file.size >= 0);
}

async function openReadHandle(path: string) {
  try { return await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) { throw new ArchiveFailure('archive_io', (error as NodeJS.ErrnoException).code === 'ELOOP' ? 'Archive transcript changed to a symbolic link' : 'Unable to open an archive transcript'); }
}

async function readBounded(file: FileInfo, signal: AbortSignal, maxBytes = MAX_FILE_BYTES): Promise<Buffer> {
  aborted(signal);
  const handle = await openReadHandle(file.path);
  try {
    const info = await verifyOpenedTarget(file, handle);
    if (info.size > MAX_FILE_BYTES) throw new ArchiveFailure('limit_exceeded', `Archive transcript exceeds the ${MAX_FILE_BYTES} byte limit`);
    if (info.size > maxBytes) throw new ArchiveFailure('limit_exceeded', `Archive exceeds the ${MAX_TOTAL_BYTES} byte scan limit`);
    totalLimitCheck(info.size);
    const parts: Buffer[] = [];
    let position = 0;
    while (position < info.size) {
      aborted(signal);
      const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK, info.size - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      parts.push(bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead));
      position += bytesRead;
      if (position > MAX_FILE_BYTES) throw new ArchiveFailure('limit_exceeded', `Archive transcript exceeds the ${MAX_FILE_BYTES} byte limit`);
    }
    aborted(signal);
    const after = await handle.stat();
    if (after.size > MAX_FILE_BYTES || after.size !== info.size || position !== info.size) {
      throw new ArchiveFailure('limit_exceeded', `Archive transcript changed or exceeds the ${MAX_FILE_BYTES} byte limit`);
    }
    return Buffer.concat(parts, position);
  } finally { await handle.close(); }
}

function totalLimitCheck(size: number) {
  if (size > MAX_FILE_BYTES) throw new ArchiveFailure('limit_exceeded', `Archive transcript exceeds the ${MAX_FILE_BYTES} byte limit`);
}

function parse(bytes: Buffer, maxRecords = MAX_RECORDS): Parsed {
  const records: Row[] = [];
  const malformedLines: Array<{ line: number }> = [];
  let lineStart = 0;
  let lineNumber = 0;
  let moreMalformedLines = false;
  let encodedRecordsBytes = 0;
  for (let end = 0; end <= bytes.length; end++) {
    if (end !== bytes.length && bytes[end] !== 0x0a) continue;
    lineNumber++;
    let lineEnd = end;
    if (lineEnd > lineStart && bytes[lineEnd - 1] === 0x0d) lineEnd--;
    const line = bytes.toString('utf8', lineStart, lineEnd);
    lineStart = end + 1;
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as Row;
      if (records.length >= maxRecords) throw new ArchiveFailure('limit_exceeded', `Archive transcript exceeds the ${maxRecords} record processing limit`);
      // Account before retaining parsed objects; no full transcript stringify.
      encodedRecordsBytes += Buffer.byteLength(JSON.stringify(record));
      if (encodedRecordsBytes > MAX_FILE_BYTES) throw new ArchiveFailure('limit_exceeded', 'Archive transcript response exceeds the 4,000,000 character limit');
      records.push(record);
    } catch (error) {
      if (error instanceof ArchiveFailure) throw error;
      if (malformedLines.length < MAX_DIAGNOSTICS) malformedLines.push({ line: lineNumber });
      else moreMalformedLines = true;
    }
  }
  return { records, malformedLines, moreMalformedLines, recordsBytes: encodedRecordsBytes, recordCount: records.length };
}

async function itemFor(file: FileInfo, signal: AbortSignal, maxBytes: number, maxRecords: number): Promise<{ item: ArchiveItem; bytes: number; records: number }> {
  const bytes = await readBounded(file, signal, maxBytes);
  const transcript = parse(bytes, maxRecords);
  const header = transcript.records.find(row => row?.type === 'session') ?? transcript.records[0] ?? {};
  const messages = transcript.records.filter(row => row?.type === 'message');
  const searchText = messages.map(row => JSON.stringify(row.message ?? row)).join('\n');
  return { item: {
    path: file.path, id: file.id, createdAt: header.timestamp ?? null,
    messageCount: messages.length, malformedLines: transcript.malformedLines.slice(0, MAX_DIAGNOSTICS),
    moreMalformedLines: transcript.moreMalformedLines, searchText,
  }, bytes: bytes.length, records: transcript.recordCount };
}

function pageArgs(input: { offset?: number; limit?: number }) {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? MAX_PAGE;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new ArchiveFailure('invalid_request', 'Archive offset must be between 0 and 1000000');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) throw new ArchiveFailure('invalid_request', `Archive page limit must be between 1 and ${MAX_PAGE}`);
  return { offset, limit };
}

function publicItems(items: ArchiveItem[], offset: number, limit: number, total: number) {
  return {
    items: items.slice(offset, offset + limit).map(item => ({
      id: item.id, createdAt: item.createdAt, messageCount: item.messageCount,
      malformedLines: item.malformedLines, moreMalformedLines: item.moreMalformedLines,
      ...(item.excerpt ? { excerpt: item.excerpt.slice(0, 400) } : {}), archiveOnly: true,
    })), total, offset, limit,
  };
}

async function allItems(roots: string[], signal: AbortSignal) {
  const indexed = await enumerate(roots, signal);
  const items: ArchiveItem[] = [];
  let bytesRead = 0;
  let recordsRead = 0;
  for (const file of indexed) {
    aborted(signal);
    const result = await itemFor(file, signal, MAX_TOTAL_BYTES - bytesRead, MAX_SCAN_RECORDS - recordsRead);
    bytesRead += result.bytes;
    recordsRead += result.records;
    items.push(result.item);
  }
  return { indexed, items };
}

function failure(call: { error: (type: 'archive_error', message: string, data: { code: FailureCode }) => unknown }, error: unknown) {
  const failure = error instanceof ArchiveFailure ? error : new ArchiveFailure('archive_io', 'Unable to read the configured archive');
  return call.error('archive_error', failure.message, { code: failure.code });
}

/** Registers a read-only view of host-configured legacy transcript roots. */
export async function registerArchive(ctx: Context, options: Options = {}) {
  const roots = await rootsFrom(options);
  return ctx.rpc.register(Archive, {
    list: async (input, call) => {
      try {
        aborted(call.signal);
        const { offset, limit } = pageArgs(input as { offset?: number; limit?: number });
        const { items } = await allItems(roots, call.signal);
        aborted(call.signal);
        return publicItems(items, offset, limit, items.length);
      } catch (error) { if (call.signal.aborted) throw error; return failure(call, error); }
    },
    search: async (input, call) => {
      try {
        aborted(call.signal);
        const { query, ...paging } = input as { query: string; offset?: number; limit?: number };
        if (!query.trim() || query.length > 200) throw new ArchiveFailure('invalid_request', 'Archive search query must contain 1 to 200 characters');
        const { offset, limit } = pageArgs(paging);
        const { items } = await allItems(roots, call.signal);
        const needle = query.toLocaleLowerCase();
        const matches = items.flatMap(item => {
          const index = item.searchText.toLocaleLowerCase().indexOf(needle);
          return index < 0 ? [] : [{ ...item, excerpt: item.searchText.slice(Math.max(0, index - 120), index + needle.length + 180) }];
        });
        aborted(call.signal);
        return publicItems(matches, offset, limit, matches.length);
      } catch (error) { if (call.signal.aborted) throw error; return failure(call, error); }
    },
    read: async (input, call) => {
      try {
        aborted(call.signal);
        const { id } = input as { id: string };
        const file = (await enumerate(roots, call.signal)).find(candidate => candidate.id === id);
        if (!file) throw new ArchiveFailure('not_found', 'Archive transcript ID was not found in configured roots');
        const transcript = parse(await readBounded(file, call.signal));
        if (transcript.recordsBytes > MAX_FILE_BYTES) throw new ArchiveFailure('limit_exceeded', 'Archive transcript response exceeds the 4,000,000 character limit');
        aborted(call.signal);
        return { id, records: transcript.records, malformedLines: transcript.malformedLines, moreMalformedLines: transcript.moreMalformedLines, archiveOnly: true };
      } catch (error) { if (call.signal.aborted) throw error; return failure(call, error); }
    },
    export: async (input, call) => {
      try {
        aborted(call.signal);
        const { id, format = 'json' } = input as { id: string; format?: 'json' | 'jsonl' };
        if (format !== 'json' && format !== 'jsonl') throw new ArchiveFailure('invalid_request', 'Export format must be json or jsonl');
        const file = (await enumerate(roots, call.signal)).find(candidate => candidate.id === id);
        if (!file) throw new ArchiveFailure('not_found', 'Archive transcript ID was not found in configured roots');
        const bytes = await readBounded(file, call.signal);
        const parsed = format === 'json' ? parse(bytes) : undefined;
        if (parsed && parsed.recordsBytes + parsed.records.length + 2 > MAX_FILE_BYTES) {
          throw new ArchiveFailure('limit_exceeded', 'Archive JSON export exceeds the 4,000,000 byte response limit');
        }
        const content = format === 'jsonl' ? bytes.toString('utf8') : `${JSON.stringify(parsed!.records)}\n`;
        if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new ArchiveFailure('limit_exceeded', 'Archive export exceeds the 4,000,000 byte response limit');
        aborted(call.signal);
        return { id, format, content, archiveOnly: true };
      } catch (error) { if (call.signal.aborted) throw error; return failure(call, error); }
    },
  });
}
