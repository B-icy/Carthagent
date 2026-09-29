import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localPath } from './delivery.mjs';

// Host storage boundary. Content-addressed originals must exist intact before
// the outbound projection can substitute a pointer. No mutation of run state.
export function archiveContext(cwd, directory, value) {
  const text = JSON.stringify(value, null, 2);
  const digest = createHash('sha256').update(text).digest('hex');
  const root = localPath(cwd, join(directory, 'context-archive'));
  mkdirSync(root, { recursive: true });
  const path = localPath(cwd, join(root, `${digest}.json`));
  try { writeFileSync(path, text, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (readFileSync(path, 'utf8') !== text) throw Error('Context archive mismatch; original messages retained');
  return { path, digest, bytes: Buffer.byteLength(text) };
}
