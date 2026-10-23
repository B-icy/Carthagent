import { chmod, mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { arch, homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { acquireOwnedRuntime } from './runtime-artifact.mjs';
import { createRuntimeGithubFetch } from './runtime-github-transport.mjs';

export const OPENCODE_VERSION = '2.0.32';
export const CTG_RUNTIME_VERSION = '0.0.0-ctg.2.0.32';
export const CTG_RUNTIME_SOURCE = '843a6c514e606b436a7fe713422ace0a93ad3d61';
export const CTG_RUNTIME_LOCK_SHA256 = '9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d';
export const CTG_RUNTIME_PATCH_SHA256 = 'b4238d77827d7ccf8f87fb0326551eaa62268d9387cd89e29bd0cf12bd6dafaa';
const DEFAULT_ROOT = path.join(homedir(), '.carthagent', 'opencode');
const require = createRequire(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNTIME_RELEASE_MANIFEST = path.join(PACKAGE_ROOT, 'lib', 'opencode', 'runtime-release.json');
// Tracks the verified cache selected by the packaged release path without
// turning it into the separate, explicitly trusted staging selector.
const RESOLVED_OWNED_RUNTIME = Symbol('resolvedOwnedRuntime');

export function resolvePathCommand(command, env = process.env, hostPlatform = platform()) {
  const entries = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const extensions = hostPlatform === 'win32' && !path.extname(command)
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')
    : [''];
  for (const entry of entries) {
    for (const extension of extensions) {
      const candidate = path.resolve(entry, `${command}${extension}`);
      try {
        const details = require('node:fs').statSync(candidate);
        if (details.isFile() && (hostPlatform === 'win32' || (details.mode & 0o111) !== 0)) return candidate;
      } catch {}
    }
  }
}

function abs(value) { return path.resolve(value); }

/** Return the isolated CTG OpenCode filesystem layout. */
export function runtimePaths(options = {}) {
  const root = abs(options.root ?? process.env.CTG_OPENCODE_HOME ?? DEFAULT_ROOT);
  return Object.freeze({
    root,
    home: path.join(root, 'home'),
    appData: path.join(root, 'home', 'AppData', 'Roaming'),
    localAppData: path.join(root, 'home', 'AppData', 'Local'),
    config: path.join(root, 'config'),
    configDir: path.join(root, 'config', 'opencode'),
    data: path.join(root, 'data'),
    state: path.join(root, 'state'),
    cache: path.join(root, 'cache'),
    serviceFile: path.join(root, 'state', 'opencode', 'service.json'),
    credentials: path.join(root, 'data', 'opencode', 'auth.json'),
    configFile: path.join(root, 'config', 'opencode', 'opencode.json'),
    lifecycleLock: path.join(root, 'state', 'opencode', 'lifecycle.lock'),
    profileLock: path.join(root, 'state', 'opencode', 'profile.lock'),
  });
}

/** Find a CTG/OpenCode executable without downloading or replacing user binaries. */
export async function resolveOpenCode(options = {}) {
  const owned = options.ownedRuntime ?? process.env.CTG_OWNED_OPENCODE_RUNTIME;
  const explicit = options.binary ?? process.env.CTG_OPENCODE_BIN;
  if (!explicit && owned) return resolveOwnedOpenCode(owned, options);
  if (!explicit) {
    const release = await readRuntimeReleaseManifest(options.runtimeReleaseManifestPath ?? RUNTIME_RELEASE_MANIFEST);
    if (release) {
      const key = `${platform() === 'win32' ? 'windows' : platform()}-${arch()}`;
      const asset = release.assets[key];
      if (!asset) throw new Error(`This CTG release does not provide its owned Carthagent runtime for ${key}; no upstream or system fallback was attempted.`);
      const root = await (options.acquireOwnedRuntime ?? acquireOwnedRuntime)({
        releaseVersion: release.releaseVersion,
        platform: platform() === 'win32' ? 'windows' : platform(),
        arch: arch(),
        assetName: asset.name,
        expectedArchiveSha256: asset.archiveSha256,
        expectedExecutableSha256: asset.executableSha256,
        expectedSourceRevision: release.sourceRevision,
        expectedPatchSha256: release.patchSha256,
        expectedLockSha256: release.lockSha256,
        expectedCompatibilityVersion: release.compatibilityVersion,
        expectedRuntimeVersion: release.runtimeVersion,
        expectedChannel: `ctg.${release.compatibilityVersion}`,
        baseUrl: options.runtimeReleaseBaseUrl ?? `https://github.com/B-icy/Carthagent/releases/download/v${release.releaseVersion}`,
        cacheRoot: options.runtimeCacheRoot,
        fetchImpl: process.env.CTG_RUNTIME_GITHUB_TOKEN
          ? createRuntimeGithubFetch({ token: process.env.CTG_RUNTIME_GITHUB_TOKEN, fetchImpl: options.fetchImpl ?? globalThis.fetch })
          : options.fetchImpl,
        signal: options.signal,
      });
      const binary = await resolveOwnedOpenCode(root, options);
      // Preserve the selection for runtimeIdentity(), but do not put it in
      // ownedRuntime: that is an explicit developer/staging trust selector.
      // Repeated resolution must pass through acquisition again so its pinned
      // executable digest is rechecked even if the cache and SHA256SUMS changed.
      Object.defineProperty(options, RESOLVED_OWNED_RUNTIME, {
        configurable: true,
        value: root,
      });
      return binary;
    }
  }
  let packaged;
  if (!explicit) {
    try {
      const packageJson = require.resolve('@opencode/cli/package.json');
      const metadata = JSON.parse(await readFile(packageJson, 'utf8'));
      const executable = typeof metadata.bin === 'string'
        ? metadata.bin
        : metadata.bin?.opencode;
      if (typeof executable !== 'string') throw new Error('package has no opencode binary entry');
      packaged = path.resolve(path.dirname(packageJson), executable);
    } catch (error) {
      throw new Error(`Packaged Carthagent runtime ${OPENCODE_VERSION} dependency could not be resolved from CTG: ${error.message}`);
    }
  }
  const candidates = explicit ? [explicit] : [packaged];
  for (const candidate of candidates) {
    if (candidate.includes(path.sep) || candidate.includes('/')) {
      try {
        const result = options.spawnImpl
          ? await runCapture(candidate, ['--version'], { timeout: 5000, spawnImpl: options.spawnImpl })
          : await runCapture(candidate, ['--version'], { timeout: 5000 });
        const version = result.stdout.trim().match(/(?:opencode\s+)?v?(\d+\.\d+\.\d+)/i)?.[1];
        if (version !== OPENCODE_VERSION) throw new Error(`Carthagent runtime ${OPENCODE_VERSION} is required; found ${version ?? 'unknown'} at ${candidate}`);
        return abs(candidate);
      } catch (error) {
        if (explicit || /is required/.test(error.message)) throw error;
      }
      } else {
      try {
        const result = await runCapture(candidate, ['--version'], { timeout: 5000, spawnImpl: options.spawnImpl, env: options.env });
        const version = result.stdout.trim().match(/(?:opencode\s+)?v?(\d+\.\d+\.\d+)/i)?.[1];
        if (version !== OPENCODE_VERSION) throw new Error(`Carthagent runtime ${OPENCODE_VERSION} is required; found ${version ?? 'unknown'} on PATH`);
        const resolved = resolvePathCommand(candidate, options.env ?? process.env);
        if (!resolved) throw new Error(`${candidate} was not found on PATH`);
        return await realpath(resolved);
      } catch (error) {
        if (explicit || /is required/.test(error.message)) throw error;
      }
    }
  }
  throw new Error(`Packaged Carthagent runtime ${OPENCODE_VERSION} was not found at ${packaged}. Reinstall CTG or set CTG_OPENCODE_BIN explicitly; CTG will not use or replace another Carthagent runtime installation.`);
}

/** Read and strictly validate the package-pinned release trust root. */
export async function readRuntimeReleaseManifest(file = RUNTIME_RELEASE_MANIFEST) {
  let manifest;
  try { manifest = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error(`Invalid CTG Carthagent runtime release manifest at ${file}: ${error.message}`);
  }
  const invalid = () => { throw new Error(`Invalid or incompatible CTG Carthagent runtime release manifest at ${file}`); };
  let packageMetadata;
  try { packageMetadata = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')); }
  catch (error) { throw new Error(`Could not verify CTG package version for runtime release manifest: ${error.message}`); }
  if (!manifest || manifest.version !== 1
    || !isReleaseVersion(manifest.releaseVersion)
    || manifest.releaseVersion !== packageMetadata.version
    || manifest.compatibilityVersion !== OPENCODE_VERSION
    || manifest.runtimeVersion !== CTG_RUNTIME_VERSION
    || manifest.sourceRevision !== CTG_RUNTIME_SOURCE
    || manifest.patchSha256 !== CTG_RUNTIME_PATCH_SHA256
    || manifest.lockSha256 !== CTG_RUNTIME_LOCK_SHA256
    || !manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) invalid();
  const allowed = new Set(['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64']);
  for (const [key, asset] of Object.entries(manifest.assets)) {
    if (!allowed.has(key) || !asset || typeof asset !== 'object'
      || asset.name !== `opencode-${key}.tar.gz`
      || !isSha256(asset.archiveSha256) || !isSha256(asset.executableSha256)) invalid();
  }
  for (const key of allowed) if (!manifest.assets[key]) invalid();
  if (Object.keys(manifest.assets).length !== allowed.size) invalid();
  return manifest;
}

function isReleaseVersion(value) {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}
function isSha256(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }

/** Resolve only a hash-verified, pinned CTG artifact; never guess a sibling binary. */
export async function resolveOwnedOpenCode(directory, options = {}) {
  const root = abs(directory);
  const manifestPath = path.join(root, 'ctg-runtime.json');
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch (error) { throw new Error(`Invalid CTG-owned Carthagent runtime manifest at ${manifestPath}: ${error.message}`); }
  if (!manifest || manifest.owner !== 'Carthagent'
    || manifest.sourceRepository !== 'https://github.com/anomalyco/opencode'
    || manifest.sourceRevision !== CTG_RUNTIME_SOURCE
    || manifest.lockSha256 !== CTG_RUNTIME_LOCK_SHA256
    || manifest.patchSha256 !== CTG_RUNTIME_PATCH_SHA256
    || manifest.compatibilityVersion !== OPENCODE_VERSION
    || manifest.runtimeVersion !== CTG_RUNTIME_VERSION
    || manifest.channel !== 'ctg.2.0.32'
    || manifest.webUI !== false) {
    throw new Error(`CTG-owned Carthagent runtime manifest is not compatible with the pinned CTG ${OPENCODE_VERSION} runtime at ${manifestPath}`);
  }
  const platformName = platform() === 'win32' ? 'windows' : platform();
  const supportedPlatform = `${platformName}-${arch()}`;
  if (manifest.platform !== supportedPlatform) {
    throw new Error(`CTG-owned Carthagent runtime platform ${manifest.platform} does not match this host ${supportedPlatform}`);
  }
  const artifactPlatform = manifest.platform;
  const executable = path.join(root, `cli-${artifactPlatform}`, 'bin', platform() === 'win32' ? 'opencode.exe' : 'opencode');
  const checksumFile = path.join(root, 'SHA256SUMS');
  const relativeExecutable = path.relative(root, executable).split(path.sep).join('/');
  let sums;
  try { sums = await readFile(checksumFile, 'utf8'); }
  catch (error) { throw new Error(`CTG-owned Carthagent runtime checksums are missing at ${checksumFile}: ${error.message}`); }
  const expected = sums.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(([hash, name]) => /^[a-f0-9]{64}$/i.test(hash || '') && name?.replace(/^\*?/, '') === relativeExecutable)?.[0];
  if (!expected) throw new Error(`CTG-owned Carthagent runtime checksum does not list ${relativeExecutable}`);
  let bytes;
  try { bytes = await readFile(executable); }
  catch (error) { throw new Error(`CTG-owned Carthagent runtime executable is missing at ${executable}: ${error.message}`); }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected.toLowerCase()) throw new Error(`CTG-owned Carthagent runtime executable SHA-256 mismatch at ${executable}`);
  const result = await runCapture(executable, ['--version'], { timeout: 5000, spawnImpl: options.spawnImpl });
  if (result.stdout.trim() !== `opencode v${CTG_RUNTIME_VERSION}`) {
    throw new Error(`CTG-owned Carthagent runtime identity mismatch at ${executable}: ${result.stdout.trim() || 'unknown version'}`);
  }
  return executable;
}

/** Describe the executable identity that a profile's persistent server must match. */
export async function runtimeIdentity(binary, options = {}) {
  const executable = await realpath(binary.includes(path.sep) || binary.includes('/') ? binary : resolvePathCommand(binary, options.env ?? process.env) ?? binary);
  const digest = createHash('sha256').update(await readFile(executable)).digest('hex');
  const ownedDirectory = options.ownedRuntime ?? process.env.CTG_OWNED_OPENCODE_RUNTIME ?? options[RESOLVED_OWNED_RUNTIME];
  if (!ownedDirectory || options.binary || process.env.CTG_OPENCODE_BIN) {
    return Object.freeze({ kind: 'upstream-compatible', binaryPath: executable, binarySha256: digest, version: OPENCODE_VERSION });
  }
  const manifest = JSON.parse(await readFile(path.join(abs(ownedDirectory), 'ctg-runtime.json'), 'utf8'));
  const artifactPlatform = manifest.platform;
  const ownedPath = await realpath(path.join(abs(ownedDirectory), `cli-${artifactPlatform}`, 'bin', platform() === 'win32' ? 'opencode.exe' : 'opencode'));
  if (ownedPath !== executable) {
    throw new Error(`CTG-owned runtime selector resolved ${executable}, but the selected artifact manifest binds ${ownedPath}`);
  }
  return Object.freeze({
    kind: 'ctg-owned', binaryPath: executable, binarySha256: digest,
    version: manifest.runtimeVersion, sourceRevision: manifest.sourceRevision,
    lockSha256: manifest.lockSha256, patchSha256: manifest.patchSha256,
    platform: manifest.platform, capabilities: { shellOrigin: true },
  });
}

/** Construct the environment for CTG-owned OpenCode children. */
export function runtimeEnvironment(options = {}) {
  const paths = runtimePaths(options);
  // OpenCode has many profile/config switches; do not inherit ambient host
  // overrides. Workspace child environments are restored through the native
  // session.environment API, not through this host process environment.
  const inherited = { ...process.env, ...(options.env ?? {}) };
  for (const key of Object.keys(inherited)) {
    if (key.toUpperCase() === 'CTG_RUNTIME_GITHUB_TOKEN') delete inherited[key];
  }
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => !key.startsWith('OPENCODE_') && key !== 'CTG_NATIVE_GLYPHS' && key !== 'CTG_TUI_GLYPHS'));
  Object.assign(env, {
    XDG_CONFIG_HOME: paths.config,
    XDG_DATA_HOME: paths.data,
    XDG_STATE_HOME: paths.state,
    XDG_CACHE_HOME: paths.cache,
    HOME: paths.home,
    APPDATA: paths.appData,
    LOCALAPPDATA: paths.localAppData,
    OPENCODE_TEST_HOME: paths.home,
    USERPROFILE: paths.home,
    OPENCODE_DB: path.join(paths.data, 'opencode.db'),
    OPENCODE_CONFIG: paths.configFile,
    OPENCODE_CONFIG_DIR: paths.configDir,
    ...(options.isolate ? { OPENCODE_CONFIG_PROJECT_DISABLE: 'true' } : {}),
    OPENCODE_DISABLE_MODELS_FETCH: 'true',
    ...(options.isolate ? { OPENCODE_DISABLE_CLAUDE_CODE: 'true', OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: 'true' } : {}),
    OPENCODE_DISABLE_AUTOUPDATE: 'true',
    CTG_OPENCODE_HOME: paths.root,
  });
  return env;
}

/** Ensure private persistent directories and CTG profile/plugin config exist. */
export async function provisionRuntime(options = {}) {
  const paths = runtimePaths(options);
  for (const directory of [paths.root, paths.home, paths.appData, paths.localAppData, paths.config, paths.configDir, paths.data, paths.state, path.dirname(paths.serviceFile), paths.cache]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => {});
  }
  await withFileLock(paths.profileLock, async () => {
    let current = {};
    try {
      current = JSON.parse(await readFile(paths.configFile, 'utf8'));
      if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error('expected a JSON object');
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Cannot preserve CTG Carthagent runtime profile at ${paths.configFile}: ${error.message}`);
    }
    const config = { ...current, ...(options.profile ?? {}), $schema: current.$schema ?? 'https://opencode.ai/config.json' };
    if (options.pluginPath) {
      const plugin = abs(options.pluginPath);
      config.plugins = replaceManagedPlugin(config.plugins, plugin);
    }
    await atomicWrite(paths.configFile, `${JSON.stringify(config, null, 2)}\n`, 0o600);
  });
  return paths;
}

/** Old checkout/install references share one plugin ID, even when paths differ.
 * Recognize the managed layout without requiring obsolete paths to still exist.
 * Leave unrelated plugins (including their options and ordering) untouched. */
function replaceManagedPlugin(plugins, plugin) {
  const entries = Array.isArray(plugins) ? plugins : [];
  const managed = entry => {
    let reference = typeof entry === 'string' ? entry : entry?.package;
    if (typeof reference !== 'string') return false;
    if (reference.startsWith('file:')) {
      try { reference = fileURLToPath(reference); } catch { return false; }
    }
    if (abs(reference) === plugin) return true;
    return /(?:^|\/)plugins\/carthagent(?:\/(?:src\/)?index\.ts)?$/.test(reference.replaceAll('\\', '/').replace(/\/+$/, ''));
  };
  const previous = entries.filter(managed);
  // Prefer the selected installation's options, otherwise retain the latest
  // managed entry's options when moving between installations.
  const selected = previous.find(entry => typeof entry === 'object' && entry?.package === plugin)
    ?? previous.findLast(entry => entry && typeof entry === 'object')
    ?? previous.at(-1);
  const replacement = selected && typeof selected === 'object' ? { ...selected, package: plugin } : plugin;
  const result = [];
  let replaced = false;
  for (const entry of entries) {
    if (!managed(entry)) result.push(entry);
    else if (!replaced) { result.push(replacement); replaced = true; }
  }
  if (!replaced) result.push(replacement);
  return result;
}

export async function atomicWrite(file, contents, mode = 0o600) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', mode);
  try {
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    await rename(temporary, file);
    await chmod(file, mode).catch(() => {});
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** Cross-process exclusive lock with bounded wait and dead-owner recovery. */
export async function withFileLock(file, action, options = {}) {
  const timeout = options.timeout ?? 15000;
  const deadline = Date.now() + timeout;
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  const token = randomUUID();
  while (!handle) {
    if (Date.now() >= deadline) throw lockTimeoutError(file);
    try {
      handle = await open(file, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: Date.now() }));
      await handle.sync();
    } catch (error) {
      if (error.code !== 'EEXIST') {
        await handle?.close().catch(() => {});
        handle = undefined;
        await rm(file, { force: true }).catch(() => {});
        throw error;
      }
      let owner;
      let observed;
      try { observed = await readFile(file, 'utf8'); owner = JSON.parse(observed); } catch {}
      const abandoned = owner?.pid ? !processAlive(owner.pid) : await stat(file)
        .then((details) => Date.now() - details.mtimeMs >= (options.staleLockAge ?? 5000))
        .catch(() => false);
      if (abandoned) {
        await options.afterStaleLockCheck?.({ file, owner });
        // Recovery itself is serialized. Never rename/unlink the contested
        // pathname after inspecting it: another contender may have replaced
        // that pathname with a fresh lock in the meantime.
        let recovery;
        try { recovery = await open(`${file}.recovery`, 'wx', 0o600); }
        catch (lockError) {
          if (lockError.code !== 'EEXIST') throw lockError;
          await new Promise((resolve) => setTimeout(resolve, Math.min(options.pollInterval ?? 40, Math.max(1, deadline - Date.now()))));
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
              ? !processAlive(latestOwner.pid)
              : await stat(file).then((details) => Date.now() - details.mtimeMs >= (options.staleLockAge ?? 5000)).catch(() => false);
            if (stillAbandoned) await rm(file, { force: true });
          }
        } finally {
          const currentRecovery = await readFile(`${file}.recovery`, 'utf8').catch(() => '');
          try { if (currentRecovery === recoveryToken) await rm(`${file}.recovery`, { force: true }); } catch {}
          await recovery.close();
        }
        continue;
      }
      if (Date.now() >= deadline) throw lockTimeoutError(file, owner);
      await new Promise((resolve) => setTimeout(resolve, Math.min(options.pollInterval ?? 40, Math.max(1, deadline - Date.now()))));
    }
  }
  try { return await action(); }
  finally {
    const owner = await readFile(file, 'utf8').catch(() => '');
    try { if (JSON.parse(owner).token === token) await rm(file, { force: true }); } catch {}
    await handle.close();
  }
}

function lockTimeoutError(file, owner) {
  const recovery = `${file}.recovery`;
  return new Error(`Timed out waiting for CTG runtime lock ${file}${owner?.pid ? ` held by process ${owner.pid}` : ''}. If no CTG process is recovering it, inspect and remove the stale lock/recovery files (${file} and ${recovery}) before retrying.`);
}

export function processAlive(pid) {
  try { process.kill(pid, 0); }
  catch (error) { return error.code === 'EPERM'; }
  if (process.platform === 'linux') {
    try {
      // kill(pid, 0) also succeeds for exited children awaiting reaping by PID 1.
      const status = readFileSync(`/proc/${pid}/stat`, 'utf8');
      return !['Z', 'X', 'x'].includes(status.slice(status.lastIndexOf(')') + 2).split(' ')[0]);
    } catch (error) { if (error.code === 'ENOENT') return false; }
  }
  return true;
}

/** Run a child process with bounded startup and captured diagnostic output. */
export function runCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const spawnImpl = options.spawnImpl ?? spawn;
    const env = { ...(options.env ?? process.env) };
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === 'CTG_RUNTIME_GITHUB_TOKEN') delete env[key];
    }
    const child = spawnImpl(command, args, { cwd: options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const cap = options.maxOutput ?? 256 * 1024;
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout = (stdout + chunk).slice(-cap); });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-cap); });
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${command} timed out after ${options.timeout ?? 30000}ms`)); }, options.timeout ?? 30000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(new Error(`${command} exited ${code ?? signal}: ${(stderr || stdout).trim().slice(-4000)}`));
    });
  });
}

/** Preserve workspace authentication/environment: do not apply CTG host XDG overrides. */
export function workspaceEnvironment(workspace, env = process.env) {
  const child = { ...env, CTG_WORKSPACE: abs(workspace) };
  for (const key of Object.keys(child)) {
    if (key.toUpperCase() === 'CTG_RUNTIME_GITHUB_TOKEN') delete child[key];
  }
  return child;
}

export async function readRuntimeCredentials(options = {}) {
  const file = runtimePaths(options).credentials;
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
