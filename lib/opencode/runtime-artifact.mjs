import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { withFileLock } from './runtime.mjs';

const MANIFEST_NAME = 'ctg-runtime.json';
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const DEFAULT_ROOT = path.join(homedir(), '.carthagent', 'opencode', 'runtimes');

const TARGETS = Object.freeze({
  'linux-x64': { platform: 'linux', arch: 'x64', executable: 'bin/opencode' },
  'linux-arm64': { platform: 'linux', arch: 'arm64', executable: 'bin/opencode' },
  'darwin-x64': { platform: 'darwin', arch: 'x64', executable: 'bin/opencode' },
  'darwin-arm64': { platform: 'darwin', arch: 'arm64', executable: 'bin/opencode' },
  'windows-x64': { platform: 'windows', arch: 'x64', executable: 'bin/opencode.exe' },
  'windows-arm64': { platform: 'windows', arch: 'arm64', executable: 'bin/opencode.exe' },
});

/**
 * Acquire one immutable CTG release artifact. All expected digests and runtime
 * identity fields must come from the caller's packaged, pinned runtime-release
 * manifest; this function never consults a latest-version pointer or treats a
 * downloaded checksum/manifest as a trust anchor.
 * Returns the installed artifact root containing ctg-runtime.json,
 * SHA256SUMS, and cli-<platform>-<arch>/bin/opencode.
 */
export async function acquireOwnedRuntime(options = {}) {
  const releaseVersion = validateVersion(options.releaseVersion);
  const target = resolveTarget(options.platform, options.arch);
  const assetName = options.assetName ?? `opencode-${target.key}.tar.gz`;
  if (assetName !== `opencode-${target.key}.tar.gz`) throw new TypeError(`assetName must be opencode-${target.key}.tar.gz`);
  const archiveSha256 = validateSha256(options.expectedArchiveSha256, 'expectedArchiveSha256');
  const expected = {
    platform: `${target.platform}-${target.arch}`,
    sourceRevision: validateRevision(options.expectedSourceRevision),
    patchSha256: validateSha256(options.expectedPatchSha256, 'expectedPatchSha256'),
    lockSha256: validateSha256(options.expectedLockSha256, 'expectedLockSha256'),
    compatibilityVersion: validateText(options.expectedCompatibilityVersion, 'expectedCompatibilityVersion'),
    runtimeVersion: validateText(options.expectedRuntimeVersion, 'expectedRuntimeVersion'),
    channel: validateText(options.expectedChannel, 'expectedChannel'),
    executableSha256: validateSha256(options.expectedExecutableSha256, 'expectedExecutableSha256'),
  };
  const baseUrl = validateBaseUrl(options.baseUrl);
  const root = path.resolve(options.cacheRoot ?? DEFAULT_ROOT);
  const releaseDir = path.join(root, releaseVersion, target.key);
  const lockPath = path.join(root, '.locks', `${releaseVersion}-${target.key}.lock`);
  await mkdir(root, { recursive: true, mode: 0o700 });

  return withFileLock(lockPath, async () => {
    // Cached checksums cannot be trusted: they live inside the writable cache.
    // Always compare executable bytes to the independently pinned digest.
    const existing = await validateInstalled(releaseDir, expected, target).catch(() => null);
    if (existing) return existing;

    const stageDir = path.join(root, '.staging', `${releaseVersion}-${target.key}-${randomUUID()}`);
    await mkdir(stageDir, { recursive: true, mode: 0o700 });
    try {
      const archive = path.join(stageDir, assetName);
      await downloadArchive(new URL(encodeURIComponent(assetName), `${baseUrl}/`), archive, options.fetchImpl ?? fetch, options.signal);
      const actualArchiveHash = await hashFile(archive);
      if (actualArchiveHash !== archiveSha256) {
        throw new Error(`CTG OpenCode ${releaseVersion} ${target.key} archive SHA-256 mismatch (expected ${archiveSha256}, got ${actualArchiveHash}).`);
      }
      const contentDir = path.join(stageDir, 'unpacked');
      await mkdir(contentDir, { mode: 0o700 });
      await unpackTarGz(archive, contentDir, target);
      await validateInstalled(contentDir, expected, target);
      await mkdir(path.dirname(releaseDir), { recursive: true, mode: 0o700 });
      const previousDir = `${releaseDir}.replaced-${randomUUID()}`;
      let movedPrevious = false;
      try {
        await rename(releaseDir, previousDir);
        movedPrevious = true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      try {
        await rename(contentDir, releaseDir);
      } catch (error) {
        if (movedPrevious) await rename(previousDir, releaseDir).catch(() => {});
        throw error;
      }
      if (movedPrevious) await rm(previousDir, { recursive: true, force: true });
      await chmod(releaseDir, 0o700).catch(() => {});
      return releaseDir;
    } catch (error) {
      throw new Error(`Could not acquire CTG-owned OpenCode ${releaseVersion} for ${target.key}: ${error.message}. Check network access or remove the incomplete cache and retry; no system OpenCode fallback was attempted.`, { cause: error });
    } finally {
      await rm(stageDir, { recursive: true, force: true }).catch(() => {});
    }
  }, { timeout: options.lockTimeout ?? 60_000 });
}

function validateVersion(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new TypeError('releaseVersion must be an exact semantic version (without a v prefix).');
  }
  return value;
}
function validateRevision(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40,64}$/i.test(value)) {
    throw new TypeError('expectedSourceRevision must be a pinned 40- to 64-character hexadecimal revision.');
  }
  return value.toLowerCase();
}
function validateText(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new TypeError(`${name} must be a non-empty pinned string.`);
  return value;
}
function validateSha256(value, name) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw new TypeError(`${name} must be a pinned 64-character SHA-256 hex digest.`);
  return value.toLowerCase();
}
function resolveTarget(platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`;
  const normalized = ({ 'win32-x64': 'windows-x64', 'win32-arm64': 'windows-arm64' })[key] ?? key;
  const target = TARGETS[normalized];
  if (!target) throw new Error(`Unsupported CTG OpenCode release target ${key}.`);
  return { ...target, key: normalized };
}
function validateBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError('baseUrl must be an HTTPS release asset base URL.'); }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new TypeError('baseUrl must use HTTPS (HTTP is allowed only for loopback fixture servers).');
  }
  if (url.username || url.password || url.search || url.hash) throw new TypeError('baseUrl must not contain credentials, a query, or a fragment.');
  return url.toString().replace(/\/+$/, '');
}

async function downloadArchive(url, destination, fetchImpl, signal) {
  const timeout = AbortSignal.timeout(120_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  for (let redirects = 0; redirects <= 5; redirects++) {
    response = await fetchImpl(url, { redirect: 'manual', signal: requestSignal });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => {});
    if (!location || redirects === 5) throw new Error('release asset returned a missing or excessive redirect chain');
    const next = new URL(location, url);
    if (next.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(next.hostname)) {
      throw new Error('release asset redirect attempted an insecure non-loopback URL');
    }
    if (next.username || next.password) throw new Error('release asset redirect included URL credentials');
    url = next;
  }
  if (!response.ok || !response.body) throw new Error(`release asset request failed with HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_ARCHIVE_BYTES) throw new Error(`release archive exceeds the ${MAX_ARCHIVE_BYTES}-byte download limit`);
  let bytes = 0;
  const limiter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > MAX_ARCHIVE_BYTES ? new Error(`release archive exceeds the ${MAX_ARCHIVE_BYTES}-byte download limit`) : null, chunk);
  } });
  await pipeline(response.body, limiter, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
}

async function hashFile(file) {
  const hash = createHash('sha256');
  const stream = createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function validateInstalled(directory, expected, target) {
  const manifestPath = path.join(directory, MANIFEST_NAME);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const required = {
    owner: 'Carthagent',
    sourceRepository: 'https://github.com/anomalyco/opencode',
    sourceRevision: expected.sourceRevision,
    lockSha256: expected.lockSha256,
    patchSha256: expected.patchSha256,
    compatibilityVersion: expected.compatibilityVersion,
    runtimeVersion: expected.runtimeVersion,
    channel: expected.channel,
    platform: expected.platform,
    webUI: false,
  };
  for (const [key, value] of Object.entries(required)) {
    if (manifest[key] !== value) throw new Error(`inner runtime manifest ${key} mismatch`);
  }
  const executablePath = `cli-${target.key}/${target.executable}`;
  const safePath = safeArchivePath(executablePath);
  const executable = path.join(directory, ...safePath.split('/'));
  const details = await lstat(executable);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error('manifest executable is not a regular file');
  const sums = await readFile(path.join(directory, 'SHA256SUMS'), 'utf8');
  const checksum = sums.split(/\r?\n/).map((line) => line.trim().split(/\s+/))
    .find(([hash, name]) => /^[a-f0-9]{64}$/i.test(hash ?? '') && name?.replace(/^\*?/, '') === executablePath)?.[0];
  if (!checksum) throw new Error(`SHA256SUMS does not list ${executablePath}`);
  const executableHash = validateSha256(checksum, 'SHA256SUMS executable entry');
  if (executableHash !== expected.executableSha256) throw new Error('SHA256SUMS executable hash does not match pinned release metadata');
  if (await hashFile(executable) !== expected.executableSha256) throw new Error('inner runtime executable SHA-256 mismatch');
  // Windows filesystems do not expose POSIX executable bits. The Unix target's
  // USTAR header is checked during extraction on every host; use cached stat
  // mode only when the host filesystem can represent it.
  if (process.platform !== 'win32' && target.platform !== 'windows' && !(details.mode & 0o111)) {
    throw new Error('inner runtime executable is not marked executable');
  }
  return directory;
}

// Deliberately small ustar reader: it accepts only regular files/directories,
// never invokes a system tar program, and rejects links and unsafe names.
async function unpackTarGz(archive, destination, target) {
  let expandedBytes = 0;
  let entries = 0;
  let buffered = Buffer.alloc(0);
  let pending = null;
  let ended = false;
  let decompressedBytes = 0;
  const gunzip = createGunzip();
  const input = createReadStream(archive).pipe(gunzip);
  const consume = async (chunk) => {
    decompressedBytes += chunk.length;
    if (decompressedBytes > MAX_EXPANDED_BYTES) throw new Error('decompressed archive exceeds the size limit');
    if (ended) {
      if (chunk.some((byte) => byte !== 0)) throw new Error('tar archive has non-zero data after its end marker');
      return;
    }
    buffered = Buffer.concat([buffered, chunk]);
    while (true) {
      if (pending) {
        const take = Math.min(pending.remaining, buffered.length);
        if (take) {
          await pending.handle.write(buffered.subarray(0, take));
          buffered = buffered.subarray(take);
          pending.remaining -= take;
        }
        if (pending.remaining) return;
        await pending.handle.sync(); await pending.handle.close(); pending = null;
        const padding = (512 - (pendingSize % 512)) % 512;
        if (buffered.length < padding) {
          pendingPadding = padding - buffered.length;
          buffered = Buffer.alloc(0);
          return;
        }
        buffered = buffered.subarray(padding);
        continue;
      }
      if (pendingPadding) {
        const take = Math.min(pendingPadding, buffered.length);
        buffered = buffered.subarray(take); pendingPadding -= take;
        if (pendingPadding) return;
        continue;
      }
      if (buffered.length < 512) return;
      const header = buffered.subarray(0, 512); buffered = buffered.subarray(512);
      if (header.every((byte) => byte === 0)) {
        ended = true;
        if (buffered.some((byte) => byte !== 0)) throw new Error('tar archive has non-zero data after its end marker');
        return;
      }
      validateTarChecksum(header);
      entries++;
      if (entries > MAX_ENTRIES) throw new Error('archive contains too many entries');
      const name = tarString(header, 0, 100);
      const prefix = tarString(header, 345, 155);
      const rawRelative = prefix ? `${prefix}/${name}` : name;
      const type = header[156];
      const size = parseTarOctal(header.subarray(124, 136));
      const mode = parseTarOctal(header.subarray(100, 108)) & 0o777;
      expandedBytes += size;
      if (expandedBytes > MAX_EXPANDED_BYTES) throw new Error('expanded archive exceeds the size limit');
      // GNU tar commonly archives `.` as a top-level directory entry.
      if ((rawRelative === '.' || rawRelative === './') && (type === 53 || type === 0) && size === 0) continue;
      const relative = safeArchivePath(rawRelative);
      const archivePath = relative.replace(/^(?:\.\/)+/, '');
      const output = path.join(destination, ...relative.split('/'));
      if (type === 53 || (type === 0 && relative.endsWith('/'))) {
        if (size) throw new Error(`directory entry ${relative} unexpectedly contains data`);
        await mkdir(output, { recursive: true, mode: 0o700 });
        continue;
      }
      if (type === 120 || type === 103) throw new Error('archive uses a PAX extension; CTG runtime release archives must use USTAR format');
      if (type !== 0 && type !== 48) throw new Error(`archive contains unsupported link or special entry ${relative}`);
      if (target.platform !== 'windows' && archivePath === `cli-${target.key}/${target.executable}` && !(mode & 0o111)) {
        throw new Error('inner runtime executable is not marked executable');
      }
      await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
      const handle = await open(output, 'wx', mode & 0o111 ? 0o700 : 0o600);
      pendingSize = size;
      pendingPadding = 0;
      pending = { handle, remaining: size, output };
      if (!size) { await handle.close(); pending = null; pendingPadding = 0; }
    }
  };
  let pendingSize = 0;
  let pendingPadding = 0;
  try {
    for await (const chunk of input) await consume(chunk);
    if (pending) { await pending.handle.close().catch(() => {}); throw new Error(`truncated archive file ${pending.output}`); }
    if (pendingPadding || (!ended && buffered.length)) throw new Error('truncated tar archive');
    if (!ended) throw new Error('tar archive has no end marker');
  } catch (error) {
    await pending?.handle.close().catch(() => {});
    throw error;
  } finally { input.destroy(); }
}

function safeArchivePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) {
    throw new Error(`unsafe archive path: ${JSON.stringify(value)}`);
  }
  const parts = value.replace(/\/$/, '').split('/');
  if (parts.some((part) => !part || part === '..')) throw new Error(`unsafe archive path: ${JSON.stringify(value)}`);
  return parts.join('/');
}
function tarString(header, start, length) {
  const end = header.indexOf(0, start);
  return header.subarray(start, end >= start && end < start + length ? end : start + length).toString('utf8');
}
function parseTarOctal(value) {
  const text = value.toString('ascii').replace(/\0.*$/, '').trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error('archive has invalid tar numeric field');
  const parsed = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(parsed)) throw new Error('archive tar numeric field exceeds supported range');
  return parsed;
}
function validateTarChecksum(header) {
  const expected = parseTarOctal(header.subarray(148, 156));
  let actual = 0;
  for (let index = 0; index < 512; index++) actual += index >= 148 && index < 156 ? 32 : header[index];
  if (actual !== expected) throw new Error('archive tar header checksum is invalid');
}
