/** Fail-closed checks shared by paired native performance fixtures. */
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, readlinkSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';

export function assertCompletePluginSource(sourceRoot) {
  const root = resolve(sourceRoot);
  const required = ['package-lock.json', 'lib/ship-auth.mjs', 'plugins/carthagent/index.ts', 'plugins/carthagent/src/index.ts',
    'plugins/carthagent/src/rpc.ts', 'plugins/carthagent/package.json',
    'plugins/carthagent/src/server/session-controls.ts', 'plugins/carthagent/src/server/providers.ts',
    'plugins/carthagent/src/server/device-auth.ts', 'plugins/carthagent/src/server/workspace-rpc.ts',
    'plugins/carthagent/src/server/pull-request-rpc.ts', 'plugins/carthagent/src/server/archive-rpc.ts'];
  const missing = required.filter(path => !existsSync(join(root, path)));
  if (missing.length) throw new Error(`Incomplete native plugin source snapshot; missing ${missing.join(', ')}`);
  assertPluginImportDependencies(join(root, 'plugins/carthagent/src/index.ts'));
  assertWorkspacePluginResolution(root);
  return { sourceRoot: root, requiredFiles: required };
}

export function assertWorkspacePluginResolution(sourceRoot) {
  const root = resolve(sourceRoot);
  const physicalPlugin = resolve(root, 'plugins/carthagent/node_modules/@opencode/plugin');
  const expectedPlugin = resolve(root, 'node_modules/@opencode/plugin');
  if (!existsSync(physicalPlugin) || !existsSync(expectedPlugin) || realpathSync(physicalPlugin) !== realpathSync(expectedPlugin)) {
    throw new Error(`Plugin workspace dependency identity mismatch: ${physicalPlugin} does not resolve to ${expectedPlugin}`);
  }
  return true;
}

export function hashDependencyPackages(nodeModulesRoot, sourcePackageJson, sourceRootOverride) {
  const root = resolve(nodeModulesRoot);
  const sourceRoot = resolve(sourceRootOverride ?? resolve(sourcePackageJson, '..'));
  const packages = ['@opencode/cli', '@opencode/client', '@opencode/plugin'];
  const sourceManifest = JSON.parse(readFileSync(sourcePackageJson, 'utf8'));
  const pluginManifest = JSON.parse(readFileSync(join(sourceRoot, 'plugins/carthagent/package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(sourceRoot, 'package-lock.json'), 'utf8'));
  return Object.fromEntries(packages.map(name => {
    const packageRoot = name === '@opencode/plugin' ? join(sourceRoot, 'node_modules/@opencode/plugin') : join(root, name);
    const manifestPath = join(packageRoot, 'package.json');
    if (!existsSync(manifestPath)) throw new Error(`Pinned dependency package is missing: ${manifestPath}`);
    const bytes = readFileSync(manifestPath);
    const manifest = JSON.parse(bytes.toString('utf8'));
    const lockVersion = name === '@opencode/plugin'
      ? lock.packages?.['node_modules/@opencode/plugin']?.version ?? lock.packages?.['plugins/carthagent']?.dependencies?.[name]
      : lock.packages?.[`node_modules/${name}`]?.version;
    const sourceRequirement = sourceManifest.dependencies?.[name] ?? pluginManifest.dependencies?.[name] ?? lock.packages?.['']?.dependencies?.[name];
    if (sourceRequirement !== manifest.version) {
      throw new Error(`Installed ${name}@${manifest.version} does not match source requirement ${sourceRequirement ?? '<missing>'}`);
    }
    if (lockVersion !== manifest.version) throw new Error(`Installed ${name}@${manifest.version} does not match selected lockfile ${lockVersion ?? '<missing>'}`);
    const tree = createHash('sha256');
    const visit = directory => {
      for (const entry of readdirSync(directory).sort()) {
        const path = join(directory, entry);
        const relative = path.slice(packageRoot.length + 1);
        const stat = lstatSync(path);
        tree.update(`${relative}\0`);
        if (stat.isSymbolicLink()) tree.update(`link:${readlinkSync(path)}\0`);
        else if (stat.isDirectory()) { tree.update('dir\0'); visit(path); }
        else if (stat.isFile()) tree.update(createHash('sha256').update(readFileSync(path)).digest());
      }
    };
    visit(packageRoot);
    return [name, { version: manifest.version, realpath: realpathSync(packageRoot),
      packageJsonSha256: createHash('sha256').update(bytes).digest('hex'), treeSha256: tree.digest('hex') }];
  }));
}

export function hashDependencyInstall(nodeModulesRoot) {
  const root = resolve(nodeModulesRoot);
  const digest = createHash('sha256');
  const visitedDirectories = new Set();
  const visitedFiles = new Set();
  const visit = directory => {
    const canonical = realpathSync(directory);
    if (visitedDirectories.has(canonical)) return;
    visitedDirectories.add(canonical);
    digest.update(`directory:${canonical}\0`);
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      const relative = path.slice(root.length + 1);
      const stat = lstatSync(path);
      digest.update(`${relative}\0`);
      if (stat.isSymbolicLink()) {
        const target = realpathSync(path);
        digest.update(`link:${readlinkSync(path)}=>${target}\0`);
        const targetStat = statSync(path);
        if (targetStat.isDirectory()) visit(path);
        else if (targetStat.isFile()) {
          if (!visitedFiles.has(target)) {
            visitedFiles.add(target);
            digest.update(createHash('sha256').update(readFileSync(path)).digest());
          }
        }
      }
      else if (stat.isDirectory()) { digest.update('dir\0'); visit(path); }
      else if (stat.isFile()) {
        const canonicalFile = realpathSync(path);
        if (!visitedFiles.has(canonicalFile)) {
          visitedFiles.add(canonicalFile);
          digest.update(createHash('sha256').update(readFileSync(path)).digest());
        }
      }
    }
  };
  visit(root);
  return { realpath: realpathSync(root), treeSha256: digest.digest('hex') };
}

export function assertDependencyPackageIdentity(expected, observed) {
  if (!expected || !observed || expected.realpath !== observed.realpath || expected.treeSha256 !== observed.treeSha256) {
    throw new Error('Dependency install identity mismatch');
  }
  return true;
}

export function assertPluginImportDependencies(pluginEntry) {
  const sourceRoot = resolve(dirname(pluginEntry), '../../..');
  const scan = new Set();
  const pending = [resolve(pluginEntry)];
  const imports = [];
  while (pending.length) {
    const file = pending.pop();
    if (scan.has(file)) continue;
    scan.add(file);
    const contents = readFileSync(file, 'utf8');
    for (const specifier of [...contents.matchAll(/(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/gm)].map(match => match[1])) {
      imports.push(specifier);
      if (!specifier.startsWith('.')) continue;
      const importedPath = resolve(dirname(file), specifier);
      const candidates = /\.[^/]+$/.test(importedPath)
        ? [importedPath]
        : [`${importedPath}.ts`, `${importedPath}.tsx`, `${importedPath}.mjs`, `${importedPath}.js`, `${importedPath}.json`, join(importedPath, 'index.ts'), join(importedPath, 'index.js')];
      const importedFile = candidates.find(candidate => existsSync(candidate));
      if (!importedFile || !importedFile.startsWith(`${sourceRoot}/`)) {
        throw new Error(`Plugin source import is missing from immutable tree: ${specifier} (${importedFile})`);
      }
      pending.push(importedFile);
    }
  }
  const sourceImports = [...new Set(imports.filter(specifier => specifier.startsWith('.')))];
  const workspaceImports = imports.filter(specifier => specifier === '@opencode/plugin' || specifier.startsWith('@opencode/plugin/'));
  if (scan.size > 1 && !workspaceImports.includes('@opencode/plugin')) throw new Error('Plugin entry does not import the pinned @opencode/plugin runtime');
  return { sourceImports, workspaceImports };
}

export function assertPluginCondition(inventory, enabled) {
  if (!Array.isArray(inventory)) throw new Error('Native plugin inventory is missing or malformed');
  const carthagent = inventory.filter(plugin => plugin?.id === 'carthagent' ||
    (typeof plugin?.id === 'string' && plugin.id.startsWith('carthagent.')));
  if (enabled) {
    const active = carthagent.find(plugin => plugin.id === 'carthagent' && plugin.state?.status === 'active');
    if (!active) {
      const details = carthagent.map(plugin => ({ id: plugin.id, status: plugin.state?.status, error: plugin.state?.error }));
      throw new Error(`Expected native Carthagent plugin to be active; observed ${JSON.stringify(details)}`);
    }
    return { expected: 'active', observed: 'active', pluginId: 'carthagent' };
  }
  const enabledPlugins = inventory.filter(plugin => plugin?.id === 'carthagent' ||
    (typeof plugin?.id === 'string' && plugin.id.startsWith('carthagent.')));
  if (enabledPlugins.length) {
    const details = enabledPlugins.map(plugin => ({ id: plugin.id, status: plugin.state?.status }));
    throw new Error(`Baseline must have no Carthagent plugin; observed ${JSON.stringify(details)}`);
  }
  return { expected: 'absent', observed: 'absent', pluginId: 'carthagent' };
}

export function aggregateConditionExit(statuses, interrupted = false) {
  const expected = ['baseline-1', 'ctg-1', 'ctg-2', 'baseline-2'];
  if (interrupted || !statuses || expected.some(name => !Number.isInteger(statuses[name]) || statuses[name] !== 0)) return 1;
  return 0;
}

export function assertSelectedSourceHead(selectedCommit, checkoutHead) {
  if (typeof selectedCommit !== 'string' || !/^[a-f0-9]{40}$/.test(selectedCommit) ||
      typeof checkoutHead !== 'string' || !/^[a-f0-9]{40}$/.test(checkoutHead) || selectedCommit !== checkoutHead) {
    throw new Error(`Selected source commit must equal the current integration checkout HEAD (selected=${selectedCommit ?? '<missing>'}, HEAD=${checkoutHead ?? '<missing>'})`);
  }
  return true;
}

export function resolveFixtureSourceRoot(plugin, executionRoot) {
  return plugin ? resolve(plugin, '../..') : resolve(executionRoot);
}

export function assertSnapshotProvenance(provenance, { verifyArtifactFiles = false } = {}) {
  for (const key of ['binarySha256', 'binaryVersion', 'sourceCommit', 'sourceCheckoutHead', 'sourceTree',
    'sourceSnapshotSha256', 'packageLockSha256', 'dependencyNodeModulesRealpath',
    'installedPackageLockSha256', 'sourceComponentSha256', 'harnessComponentSha256', 'sourceArchiveSha256',
    'executionSnapshotTar', 'executionSnapshotSha256', 'sourceSnapshotTar', 'binary', 'dependencyInstallSha256', 'dependencyInstallRealpath',
    'sourceCheckoutStatusSha256']) {
    if (typeof provenance?.[key] !== 'string' || !provenance[key]) throw new Error(`Missing provenance field: ${key}`);
  }
  if (typeof provenance.sourceCheckoutDirtyStatus !== 'string' || typeof provenance.harnessDirtyStatus !== 'string') {
    throw new Error('Missing checkout dirty-state status provenance');
  }
  if (provenance.binaryVersion !== '2.0.32' || !/^[a-f0-9]{64}$/.test(provenance.binarySha256) ||
      !/^[a-f0-9]{40}$/.test(provenance.sourceCommit) || provenance.sourceCheckoutHead !== provenance.sourceCommit ||
      !/^[a-f0-9]{40}$/.test(provenance.sourceTree) ||
      !/^[a-f0-9]{64}$/.test(provenance.sourceSnapshotSha256) || !/^[a-f0-9]{64}$/.test(provenance.packageLockSha256) ||
      !/^[a-f0-9]{64}$/.test(provenance.sourceComponentSha256) || !/^[a-f0-9]{64}$/.test(provenance.harnessComponentSha256) ||
      !/^[a-f0-9]{64}$/.test(provenance.sourceArchiveSha256) ||
      !/^[a-f0-9]{64}$/.test(provenance.executionSnapshotSha256) ||
      !/^[a-f0-9]{64}$/.test(provenance.dependencyInstallSha256) ||
      !/^[a-f0-9]{64}$/.test(provenance.sourceCheckoutStatusSha256) ||
      !provenance.dependencyNodeModulesRealpath.startsWith('/') || !provenance.dependencyInstallRealpath.startsWith('/')) {
    throw new Error('Pinned binary or source snapshot provenance is invalid');
  }
  if (typeof provenance.sourceDirty !== 'boolean' || typeof provenance.sourceCheckoutDirty !== 'boolean' ||
      provenance.sourceCheckoutDirty !== (provenance.sourceCheckoutDirtyStatus.length > 0) ||
      createHash('sha256').update(provenance.sourceCheckoutDirtyStatus).digest('hex') !== provenance.sourceCheckoutStatusSha256 ||
      typeof provenance.harnessDirty !== 'boolean' ||
      provenance.harnessDirty !== (provenance.harnessDirtyStatus.length > 0)) {
    throw new Error('Checkout dirty-state provenance is invalid');
  }
  if (provenance.sourceDirty !== false) throw new Error('Source snapshot must be created from a clean immutable commit');
  const dependencyPackages = provenance.dependencyPackages;
  if (!dependencyPackages || typeof dependencyPackages !== 'object') throw new Error('Pinned dependency package provenance is missing');
  for (const name of ['@opencode/cli', '@opencode/client', '@opencode/plugin']) {
    const item = dependencyPackages[name];
    if (item?.version !== '2.0.32' || typeof item.realpath !== 'string' || !item.realpath.startsWith('/') ||
        !/^[a-f0-9]{64}$/.test(item.packageJsonSha256 ?? '') || !/^[a-f0-9]{64}$/.test(item.treeSha256 ?? '')) {
      throw new Error(`Pinned dependency provenance is invalid for ${name}`);
    }
  }
  if (provenance.installedPackageLockSha256 !== provenance.packageLockSha256) {
    throw new Error('Installed dependencies are not identical to the selected source lockfile');
  }
  if (verifyArtifactFiles) {
    const binaryPath = provenance.binary;
    const sourceTar = provenance.sourceSnapshotTar;
    const executionTar = provenance.executionSnapshotTar;
    for (const [label, path, expected] of [
      ['binary', binaryPath, provenance.binarySha256],
      ['source archive', sourceTar, provenance.sourceArchiveSha256],
      ['execution snapshot', executionTar, provenance.executionSnapshotSha256],
    ]) {
      if (typeof path !== 'string' || !existsSync(path) || createHash('sha256').update(readFileSync(path)).digest('hex') !== expected) {
        throw new Error(`${label} artifact hash does not match manifest provenance`);
      }
    }
    const dependencyInstall = hashDependencyInstall(provenance.dependencyNodeModulesRealpath);
    if (dependencyInstall.treeSha256 !== provenance.dependencyInstallSha256 || dependencyInstall.realpath !== provenance.dependencyInstallRealpath) {
      throw new Error('dependency install artifact hash does not match manifest provenance');
    }
  }
  return true;
}

export function verifySnapshotIdentity(expected, observed, { verifyArtifactFiles = true } = {}) {
  assertSnapshotProvenance(observed, { verifyArtifactFiles });
  for (const key of ['binarySha256', 'binaryVersion', 'sourceCommit', 'sourceCheckoutHead', 'sourceTree',
    'sourceDirty', 'sourceCheckoutDirty', 'sourceCheckoutDirtyStatus', 'sourceCheckoutStatusSha256', 'harnessDirty', 'harnessDirtyStatus',
    'sourceSnapshotSha256', 'packageLockSha256', 'dependencyNodeModulesRealpath',
    'installedPackageLockSha256', 'sourceComponentSha256', 'harnessComponentSha256', 'sourceArchiveSha256',
    'executionSnapshotTar', 'executionSnapshotSha256', 'sourceSnapshotTar', 'binary', 'dependencyInstallSha256', 'dependencyInstallRealpath']) {
    if (expected?.[key] !== observed[key]) throw new Error(`Snapshot identity mismatch for ${key}`);
  }
  if (JSON.stringify(expected?.dependencyPackages) !== JSON.stringify(observed.dependencyPackages)) {
    throw new Error('Snapshot identity mismatch for dependencyPackages');
  }
  return true;
}
