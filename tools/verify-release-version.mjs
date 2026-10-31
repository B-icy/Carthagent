import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const tag = process.argv[2];
if (!tag) {
  console.error('Usage: node tools/verify-release-version.mjs <release-tag>');
  process.exit(2);
}

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const version = packageJson.version;

if (tag !== `v${version}`) {
  throw new Error(`Release tag ${tag} must be v${version} to match package.json`);
}
if (lock.version !== version || lock.packages?.['']?.version !== version) {
  throw new Error(`package-lock.json root versions must both match package.json (${version})`);
}

const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
if (packed.status !== 0) {
  process.stderr.write(packed.stderr);
  process.exit(packed.status ?? 1);
}

let packInfo;
try {
  packInfo = JSON.parse(packed.stdout);
} catch {
  throw new Error(`Could not read npm pack manifest output: ${packed.stdout}`);
}
if (packInfo.length !== 1 || packInfo[0].name !== packageJson.name || packInfo[0].version !== version) {
  throw new Error(`Packed npm manifest must be ${packageJson.name}@${version}`);
}

// npm publish silently drops bin entries it considers invalid (npm 11 rejects
// "./bin/ctg.mjs"), so a published version could ship without the ctg command.
// Check the publish-time manifest npm itself would upload, not package.json.
const published = spawnSync('npm', ['publish', '--dry-run', '--json', '--tag', 'next'], { encoding: 'utf8' });
if (published.status !== 0) {
  process.stderr.write(published.stderr);
  process.exit(published.status ?? 1);
}
const corrections = published.stderr.split('\n').filter(line => /auto-corrected|was invalid and removed/.test(line));
if (corrections.length) {
  throw new Error(`npm publish would rewrite package.json; fix it before releasing:\n${published.stderr}`);
}
const binPath = packageJson.bin?.ctg;
if (typeof binPath !== 'string' || binPath.startsWith('./')) {
  throw new Error(`package.json bin.ctg must be a plain relative path npm publish keeps (got ${JSON.stringify(binPath)})`);
}
if (!packInfo[0].files.some(file => file.path === binPath && (file.mode & 0o111))) {
  throw new Error(`Packed npm package must contain executable ${binPath} for the ctg command`);
}

console.log(`Verified release tag ${tag}, lockfile, and packed package ${packageJson.name}@${version} with ctg -> ${binPath}`);
