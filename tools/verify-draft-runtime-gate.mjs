import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REQUIRED_RUNTIME_ASSETS = Object.freeze([
  'opencode-linux-x64.tar.gz',
  'opencode-linux-arm64.tar.gz',
  'opencode-darwin-x64.tar.gz',
  'opencode-darwin-arm64.tar.gz',
  'opencode-windows-x64.tar.gz',
]);
export const REQUIRED_RELEASE_ASSETS = Object.freeze([
  ...REQUIRED_RUNTIME_ASSETS,
  'runtime-release.json',
  'runtime-release-SHA256SUMS.txt',
]);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRepository = 'B-icy/Carthagent';

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}

/** Check the exact remote draft/tag and local checkout before or after acceptance. */
export async function verifyDraftRuntimeGate({
  phase,
  releaseTag,
  expectedSha,
  expectedReleaseId,
  repo = apiRepository,
  cwd = process.cwd(),
  env = process.env,
  run = runCommand,
}) {
  if (!['before', 'recheck', 'after'].includes(phase)) throw new Error('phase must be before, recheck, or after');
  if (repo !== apiRepository) throw new Error(`Draft runtime gate is restricted to ${apiRepository}.`);
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (releaseTag !== `v${packageJson.version}`) {
    throw new Error(`Release tag must be exactly v${packageJson.version}, received ${JSON.stringify(releaseTag)}.`);
  }
  const version = packageJson.version;
  const releases = await listReleases({ repo, env, run });
  const matches = releases.filter((release) => release?.tag_name === releaseTag);
  if (matches.length !== 1) throw new Error(matches.length ? 'GitHub returned duplicate exact-tag releases.' : `No release exists for ${releaseTag}.`);
  const release = matches[0];
  if (release.draft !== true) throw new Error(`Release ${releaseTag} must remain a draft during installed acceptance.`);
  if (!Number.isSafeInteger(release.id) || release.id <= 0) throw new Error('GitHub returned invalid draft release identity.');
  if (expectedReleaseId !== undefined && String(release.id) !== String(expectedReleaseId)) {
    throw new Error(`Draft release identity changed during acceptance (expected ${expectedReleaseId}, found ${release.id}).`);
  }
  assertRuntimeAssets(release.assets, releaseTag);

  const remoteSha = await resolveRemoteTag({ repo, releaseTag, env, run });
  const checkoutSha = run('git', ['rev-parse', 'HEAD'], { cwd, env }).trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(checkoutSha)) throw new Error('Could not identify the checked-out release commit.');
  if (remoteSha !== checkoutSha) throw new Error(`Release tag ${releaseTag} resolves to ${remoteSha}, but this checkout is ${checkoutSha}.`);
  if (phase === 'recheck' || phase === 'after') {
    if (!/^[a-f0-9]{40}$/.test(expectedSha ?? '')) throw new Error(`${phase} check requires the pre-acceptance tested SHA.`);
    if (remoteSha !== expectedSha.toLowerCase()) throw new Error(`Release tag changed during acceptance: expected ${expectedSha}, found ${remoteSha}.`);
    if (!/^[1-9][0-9]*$/.test(String(expectedReleaseId ?? ''))) throw new Error(`${phase} check requires the pre-acceptance draft release ID.`);
  }
  return Object.freeze({ releaseId: release.id, sha: remoteSha, version });
}

function assertRuntimeAssets(assets, tag) {
  if (!Array.isArray(assets)) throw new Error(`Draft release ${tag} has no asset list.`);
  const names = assets.map((asset) => asset?.name);
  for (const name of REQUIRED_RELEASE_ASSETS) {
    const count = names.filter((candidate) => candidate === name).length;
    if (count !== 1) throw new Error(`Draft release ${tag} must contain exactly one ${name} asset.`);
  }
  const unexpected = names.filter((name) => !REQUIRED_RELEASE_ASSETS.includes(name));
  if (unexpected.length) throw new Error(`Draft release ${tag} contains unexpected assets: ${unexpected.join(', ')}.`);
  if (names.length !== REQUIRED_RELEASE_ASSETS.length) {
    throw new Error(`Draft release ${tag} must contain exactly the seven reviewed runtime release assets.`);
  }
}

async function listReleases({ repo, env, run }) {
  const output = run('gh', ['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`], { env });
  let pages;
  try { pages = JSON.parse(output); }
  catch { throw new Error('GitHub returned invalid release-list JSON.'); }
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw new Error('GitHub returned invalid paginated release metadata.');
  return pages.flat();
}

async function resolveRemoteTag({ repo, releaseTag, env, run }) {
  let ref;
  try { ref = JSON.parse(run('gh', ['api', `repos/${repo}/git/ref/tags/${releaseTag}`], { env })); }
  catch (error) { throw new Error(`Could not resolve remote tag ${releaseTag}: ${error.message}`); }
  let type = ref?.object?.type;
  let sha = ref?.object?.sha;
  for (let depth = 0; type === 'tag'; depth++) {
    if (depth >= 5) throw new Error(`Release tag ${releaseTag} has excessive nested annotated tags.`);
    if (!/^[a-f0-9]{40}$/i.test(sha ?? '')) throw new Error(`Release tag ${releaseTag} has an invalid annotated tag object.`);
    let annotated;
    try { annotated = JSON.parse(run('gh', ['api', `repos/${repo}/git/tags/${sha}`], { env })); }
    catch (error) { throw new Error(`Could not resolve annotated tag object for ${releaseTag}: ${error.message}`); }
    type = annotated?.object?.type;
    sha = annotated?.object?.sha;
  }
  if (type !== 'commit' || !/^[a-f0-9]{40}$/i.test(sha ?? '')) {
    throw new Error(`Release tag ${releaseTag} must resolve to a commit.`);
  }
  return sha.toLowerCase();
}

async function main(args) {
  const [phase, releaseTag] = args;
  if (!['before', 'recheck', 'after'].includes(phase) || !releaseTag) {
    console.error('Usage: node tools/verify-draft-runtime-gate.mjs <before|recheck|after> <release-tag>');
    process.exit(2);
  }
  const result = await verifyDraftRuntimeGate({
    phase,
    releaseTag,
    expectedSha: process.env.EXPECTED_SHA,
    expectedReleaseId: process.env.EXPECTED_RELEASE_ID,
    repo: process.env.GITHUB_REPOSITORY,
    cwd: process.cwd(),
  });
  if (phase === 'before') {
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required for the pre-acceptance gate.');
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_OUTPUT, `tested_sha=${result.sha}\nrelease_id=${result.releaseId}\n`);
  }
  console.log(`Verified draft release ${releaseTag} at ${result.sha} (${phase} installed acceptance).`);
}

function runCommand(command, args, { cwd, env } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}: ${(result.stderr || result.stdout).trim().slice(-2000)}`);
  return result.stdout;
}
