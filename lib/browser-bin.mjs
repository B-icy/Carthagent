/**
 * Bundled browser provisioning — downloads the lightweight `chrome-headless-shell`
 * build from Chrome for Testing on demand and caches it under the carthagent
 * data dir. Zero npm deps; zip entries are extracted with node:zlib.
 *
 * Resolution order for checks: CARTHAGENT_BROWSER env → bundled shell →
 * system chrome/chromium → Firefox (legacy fallback).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';

export const BUNDLED_BROWSER_VERSION = process.env.CARTHAGENT_BROWSER_VERSION || '154.0.8037.92';

const SHELL_URL = version => `https://storage.googleapis.com/chrome-for-testing-public/${version}/${platformKey()}/chrome-headless-shell-${platformKey()}.zip`;

function platformKey() {
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux-arm64' : 'linux64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (process.platform === 'win32') return process.arch === 'x64' ? 'win64' : 'win32';
  throw Error(`Unsupported platform ${process.platform}/${process.arch} for the bundled browser`);
}

export function browserRoot(base = join(homedir(), '.carthagent')) {
  return join(base, 'browser');
}

/** Expected path of the bundled shell binary for this platform. */
export function bundledBinaryPath({ version = BUNDLED_BROWSER_VERSION, base } = {}) {
  const key = platformKey();
  const name = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
  return join(browserRoot(base), version, `chrome-headless-shell-${key}`, name);
}

/** True when Chromium's stderr indicates the process sandbox cannot start
 * (Ubuntu ≥23.10 AppArmor, containers without userns). The caller should
 * retry once with --no-sandbox. */
export function isSandboxFailure(stderr = '') {
  return /unprivileged user namespaces|apparmor|SUID sandbox|cannot run as root|sandbox/i.test(stderr);
}

/** Locate a usable headless browser: env → bundled → system chrome/chromium → firefox. */
export function findBrowser({ env = process.env } = {}) {
  const chromium = findChromium({ env });
  if (chromium) return chromium;
  if (env.FIREFOX && existsSync(env.FIREFOX)) return env.FIREFOX;
  for (const candidate of ['/usr/bin/firefox', '/snap/bin/firefox']) if (existsSync(candidate)) return candidate;
  return null;
}

/** Chromium-family binary only (CDP/flag dialect): env → bundled → system chrome/chromium. */
export function findChromium({ env = process.env } = {}) {
  if (env.CARTHAGENT_BROWSER && existsSync(env.CARTHAGENT_BROWSER)) return env.CARTHAGENT_BROWSER;
  const bundled = bundledBinaryPath();
  if (existsSync(bundled)) return bundled;
  const names = process.platform === 'win32'
    ? ['chrome-headless-shell.exe', 'chrome.exe', 'chromium.exe']
    : ['chrome-headless-shell', 'google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'];
  for (const dir of (env.PATH || '').split(delimiter)) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Minimal zip extractor (store + deflate). Parses the end-of-central-directory
 * record and central directory, then reads each local file entry. Sufficient
 * for Chrome for Testing archives without shelling out to unzip/tar.
 */
export function extractZip(zipPath, destDir) {
  const buf = readFileSync(zipPath);
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === eocdSig) { eocd = i; break; }
  }
  if (eocd < 0) throw Error('zip: end of central directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const written = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw Error('zip: corrupt central directory');
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    const localOffset = buf.readUInt32LE(offset + 42);
    offset += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith('/')) continue;
    const rel = name.split('\\').join('/');
    if (rel.split('/').some(seg => seg === '..' || seg === '' || isDangerousAbsolute(rel))) throw Error(`zip: refusing entry ${rel}`);
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw Error('zip: corrupt local header');
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
    if (data == null) throw Error(`zip: unsupported compression method ${method} for ${rel}`);
    const out = join(destDir, rel);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, data);
    written.push(out);
  }
  return written;
}

function isDangerousAbsolute(rel) {
  return rel.startsWith('/') || /^[a-zA-Z]:\//.test(rel);
}

/**
 * Download + cache the bundled headless shell for this platform.
 * `CARTHAGENT_BROWSER_VERSION` pins a specific Chrome for Testing build; the
 * default tracks the last-known-good stable version recorded at build time.
 * Returns the binary path. Download artifacts land in a sibling temp dir and
 * are renamed into place so interrupted installs never leave a half binary.
 */
export async function ensureBundledBrowser({ version = BUNDLED_BROWSER_VERSION, fetchImpl = globalThis.fetch, base } = {}) {
  const bin = bundledBinaryPath({ version, base });
  if (existsSync(bin)) return bin;
  if (typeof fetchImpl !== 'function') throw Error('Bundled browser download requires fetch support');
  const root = browserRoot(base);
  mkdirSync(root, { recursive: true });
  // Stage under `root` (not tmpdir) so the final rename stays on one filesystem.
  const stage = mkdtempSync(join(root, '.stage-'));
  try {
    const url = SHELL_URL(version);
    const response = await fetchImpl(url);
    if (!response.ok) throw Error(`Bundled browser download failed (${response.status}) for ${url}`);
    const zip = join(stage, 'shell.zip');
    writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
    const extracted = join(stage, 'out');
    extractZip(zip, extracted);
    const leaf = `chrome-headless-shell-${platformKey()}`;
    const target = join(root, version);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    renameSync(join(extracted, leaf), join(target, leaf));
    const name = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
    const binary = join(target, leaf, name);
    if (!existsSync(binary)) throw Error('Bundled browser archive did not contain the shell binary');
    if (process.platform !== 'win32') chmodSync(binary, 0o755);
    // Cheap self-check: the shell should answer --version without a display.
    const probe = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 15000 });
    if (probe.status !== 0) {
      rmSync(target, { recursive: true, force: true });
      throw Error(`Bundled browser failed --version probe: ${(probe.stderr || probe.error?.message || '').slice(0, 200)}`);
    }
    return binary;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
