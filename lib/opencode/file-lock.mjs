import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const alive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
};

function timeoutError(file, owner) {
  return new Error(`Timed out waiting for CTG credential lock ${file}${owner?.pid ? ` held by process ${owner.pid}` : ''}. If recovery is stuck, inspect the lock and recovery files before retrying.`);
}

/** Acquire a cross-process lock with bounded wait and serialized dead-lock recovery. */
export async function acquireFileLock(file, options = {}) {
  const timeout = options.timeout ?? 15_000;
  const deadline = Date.now() + timeout;
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  const token = randomUUID();
  while (!handle) {
    if (Date.now() >= deadline) throw timeoutError(file);
    try {
      handle = await open(file, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: Date.now() }));
      await handle.sync();
    } catch (error) {
      if (error.code !== 'EEXIST') {
        await handle?.close().catch(() => {});
        handle = undefined;
        throw error;
      }
      let owner;
      let observed;
      try { observed = await readFile(file, 'utf8'); owner = JSON.parse(observed); } catch {}
      const abandoned = owner?.pid
        ? !alive(owner.pid)
        : await stat(file).then(details => Date.now() - details.mtimeMs >= (options.staleLockAge ?? 5000)).catch(() => false);
      if (abandoned) {
        let recovery;
        try { recovery = await open(`${file}.recovery`, 'wx', 0o600); }
        catch (lockError) {
          if (lockError.code !== 'EEXIST') throw lockError;
          await new Promise(resolve => setTimeout(resolve, Math.min(options.pollInterval ?? 40, Math.max(1, deadline - Date.now()))));
          continue;
        }
        const recoveryToken = JSON.stringify({ pid: process.pid, token: randomUUID() });
        try {
          await recovery.writeFile(recoveryToken);
          await recovery.sync();
          const latest = await readFile(file, 'utf8').catch(() => '');
          let latestOwner;
          try { latestOwner = JSON.parse(latest); } catch {}
          if (latest === observed) {
            const stillAbandoned = latestOwner?.pid
              ? !alive(latestOwner.pid)
              : await stat(file).then(details => Date.now() - details.mtimeMs >= (options.staleLockAge ?? 5000)).catch(() => false);
            if (stillAbandoned) await rm(file, { force: true });
          }
        } finally {
          const currentRecovery = await readFile(`${file}.recovery`, 'utf8').catch(() => '');
          try { if (currentRecovery === recoveryToken) await rm(`${file}.recovery`, { force: true }); } catch {}
          await recovery.close();
        }
        continue;
      }
      if (Date.now() >= deadline) throw timeoutError(file, owner);
      await new Promise(resolve => setTimeout(resolve, Math.min(options.pollInterval ?? 40, Math.max(1, deadline - Date.now()))));
    }
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const owner = await readFile(file, 'utf8').catch(() => '');
    try { if (JSON.parse(owner).token === token) await rm(file, { force: true }); } catch {}
    await handle.close();
  };
}

/** Cross-process critical section; lock ownership is always released in finally. */
export async function withFileLock(file, action, options = {}) {
  const release = await acquireFileLock(file, options);
  try { return await action(); }
  finally { await release(); }
}
