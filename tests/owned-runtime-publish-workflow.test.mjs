import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(root, '.github/workflows/publish-owned-opencode-runtime.yml');
const workflow = await readFile(workflowPath, 'utf8');
const workflowPathName = '.github/workflows/publish-owned-opencode-runtime.yml';
const sourceCommit = '843a6c514e606b436a7fe713422ace0a93ad3d61';
const lockSha256 = '9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d';
const releaseVersion = '1.2.3';
const releaseTag = `v${releaseVersion}`;
const workflowId = 987;
const runId = 4242;
const runSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const tagObject = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const tagCommit = 'cccccccccccccccccccccccccccccccccccccccc';
const requiresUbuntuWorkflowShell = process.platform !== 'linux'
  ? 'the workflow steps under test run on ubuntu-latest and require Bash/GNU checksum utilities'
  : false;
const targets = [
  ['linux-x64', 'linux', 'x64', 'opencode-linux-x64.tar.gz', 'cli-linux-x64/bin/opencode'],
  ['linux-arm64', 'linux', 'arm64', 'opencode-linux-arm64.tar.gz', 'cli-linux-arm64/bin/opencode'],
  ['darwin-x64', 'darwin', 'x64', 'opencode-darwin-x64.tar.gz', 'cli-darwin-x64/bin/opencode'],
  ['darwin-arm64', 'darwin', 'arm64', 'opencode-darwin-arm64.tar.gz', 'cli-darwin-arm64/bin/opencode'],
  ['windows-x64', 'windows', 'x64', 'opencode-windows-x64.tar.gz', 'cli-windows-x64/bin/opencode.exe'],
];

function extractRunBlock(selector) {
  const lines = workflow.split(/\r?\n/);
  const selectorIndex = lines.findIndex((line) => selector(lines, line));
  assert.notEqual(selectorIndex, -1, 'workflow step selector must match');
  const selectorIndent = lines[selectorIndex].match(/^ */)?.[0].length ?? 0;
  let stepStart = -1;
  let stepIndent = -1;
  for (let index = selectorIndex; index >= 0; index -= 1) {
    const match = lines[index].match(/^( *)- (?:name|uses):/);
    if (match && match[1].length < selectorIndent + 2) {
      stepStart = index;
      stepIndent = match[1].length;
      break;
    }
  }
  assert.notEqual(stepStart, -1, 'selected workflow line must belong to a step');
  let stepEnd = lines.length;
  const nextStep = new RegExp(`^ {${stepIndent}}- (?:name|uses):`);
  for (let index = stepStart + 1; index < lines.length; index += 1) {
    if (nextStep.test(lines[index])) { stepEnd = index; break; }
  }
  const runIndex = lines.findIndex((line, index) => index > selectorIndex && index < stepEnd && /^\s+run: \|\s*$/.test(line));
  assert.notEqual(runIndex, -1, 'selected workflow step must use a literal run block');
  const indent = lines[runIndex + 1].match(/^ */)?.[0].length;
  assert.ok(Number.isInteger(indent) && indent > 0, 'run block must have indented content');
  const body = [];
  for (let index = runIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && (line.match(/^ */)?.[0].length ?? 0) < indent) break;
    body.push(line.trim() ? line.slice(indent) : '');
  }
  return body.join('\n');
}

const validateBlock = extractRunBlock((_lines, line) => line.trim() === 'id: validate');
const verifyBlock = extractRunBlock((_lines, line) => line.trim() === 'id: verify');
const uploadBlock = extractRunBlock((_lines, line) => line.includes('name: Recheck immutable draft target and upload verified bytes without clobbering'));

function workflowJob(name) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(start, -1, `workflow job ${name} must exist`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:$/.test(lines[index])) { end = index; break; }
  }
  return lines.slice(start, end).join('\n');
}

const combinedPatchPath = 'docs/patches/opencode-v2.0.32-session-ui-combined-v2.patch';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function octal(value, width) {
  return Buffer.from(`${value.toString(8).padStart(width - 1, '0')}\0`);
}

function tarEntry(name, data, type = '0', mode = 0o644) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  octal(mode, 8).copy(header, 100);
  octal(0, 8).copy(header, 108);
  octal(0, 8).copy(header, 116);
  octal(data.length, 12).copy(header, 124);
  octal(0, 12).copy(header, 136);
  header.fill(32, 148, 156);
  header[156] = type.charCodeAt(0);
  header.write('ustar\0', 257, 6);
  header.write('00', 263, 2);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  octal(checksum, 8).copy(header, 148);
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

function makeRuntimeArchive(key, platform, arch, executablePath, executableBytes, runtimeManifest) {
  const parentEntries = executablePath.split('/').slice(0, -1).map((_, index, parts) => {
    const name = `${parts.slice(0, index + 1).join('/')}/`;
    return tarEntry(name, Buffer.alloc(0), '5');
  });
  const packageJson = Buffer.from(JSON.stringify({
    name: `@opencode/cli-${key}`,
    version: '0.0.0-ctg.2.0.32',
    os: [platform === 'windows' ? 'win32' : platform],
    cpu: [arch],
  }));
  const sums = Buffer.from(`${sha256(executableBytes)}  ${executablePath}\n`);
  return gzipSync(Buffer.concat([
    tarEntry('./', Buffer.alloc(0), '5'),
    ...parentEntries,
    tarEntry(executablePath, executableBytes, '0', 0o755),
    tarEntry(`cli-${key}/package.json`, packageJson),
    tarEntry('LICENSE', Buffer.from('MIT License\n')),
    tarEntry('SHA256SUMS', sums),
    tarEntry('ctg-runtime.json', Buffer.from(JSON.stringify(runtimeManifest))),
    Buffer.alloc(1024),
  ]));
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ctg-owned-runtime-publish-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const candidate = path.join(directory, 'candidate');
  const ctg = path.join(directory, 'ctg');
  const generator = path.join(directory, 'release-generator/tools/generate-owned-runtime-release.mjs');
  const fakeBin = path.join(directory, 'bin');
  const capture = path.join(directory, 'upload-capture');
  await Promise.all([
    mkdir(candidate), mkdir(path.join(ctg, 'lib/opencode'), { recursive: true }),
    mkdir(path.join(ctg, 'script/ctg'), { recursive: true }), mkdir(path.join(ctg, 'docs/patches'), { recursive: true }),
    mkdir(path.dirname(generator), { recursive: true }), mkdir(fakeBin), mkdir(capture),
  ]);
  await writeFile(path.join(ctg, 'package.json'), JSON.stringify({ name: 'fixture', version: releaseVersion }));
  const patch = await readFile(path.join(root, combinedPatchPath));
  const patchSha256 = sha256(patch);
  await Promise.all([
    copyFile(path.join(root, 'script/ctg/build-owned-runtime.sh'), path.join(ctg, 'script/ctg/build-owned-runtime.sh')),
    copyFile(path.join(root, combinedPatchPath), path.join(ctg, combinedPatchPath)),
  ]);
  execFileSync('git', ['init', '-q'], { cwd: ctg });
  execFileSync('git', ['-c', 'user.name=Workflow Fixture', '-c', 'user.email=fixture@example.invalid', 'add', combinedPatchPath], { cwd: ctg });
  execFileSync('git', ['-c', 'user.name=Workflow Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture candidate patch'], { cwd: ctg });
  await copyFile(path.join(root, 'lib/opencode/runtime.mjs'), path.join(ctg, 'lib/opencode/runtime.mjs'));

  const manifest = {
    version: 1,
    releaseVersion,
    compatibilityVersion: '2.0.32',
    runtimeVersion: '0.0.0-ctg.2.0.32',
    sourceRevision: sourceCommit,
    patchSha256,
    lockSha256,
    assets: {},
  };
  for (const [key, platform, arch, name, executablePath] of targets) {
    const executableBytes = Buffer.from(`tiny test executable for ${key}\n`);
    const runtimeMetadata = {
      owner: 'Carthagent',
      sourceRepository: 'https://github.com/anomalyco/opencode',
      sourceRevision: sourceCommit,
      lockSha256,
      patchSha256,
      compatibilityVersion: '2.0.32',
      runtimeVersion: '0.0.0-ctg.2.0.32',
      channel: 'ctg.2.0.32',
      platform: `${platform}-${arch}`,
      webUI: false,
    };
    const archiveBytes = makeRuntimeArchive(key, platform, arch, executablePath, executableBytes, runtimeMetadata);
    const record = {
      version: 1, target: key, platform, arch, sourceRevision: sourceCommit, patchSha256, lockSha256,
      compatibilityVersion: '2.0.32', runtimeVersion: '0.0.0-ctg.2.0.32',
      executableSha256: sha256(executableBytes),
    };
    await writeFile(path.join(candidate, name), archiveBytes);
    await writeFile(path.join(candidate, `${name}.build.json`), JSON.stringify(record));
    manifest.assets[key] = { name, archiveSha256: sha256(archiveBytes), executableSha256: sha256(executableBytes) };
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(ctg, 'lib/opencode/runtime-release.json'), manifestBytes);
  await writeFile(path.join(candidate, 'runtime-release.json.candidate'), manifestBytes);
  const archiveNames = targets.map((entry) => entry[3]).sort();
  const archiveSums = [];
  for (const name of archiveNames) archiveSums.push(`${sha256(await readFile(path.join(candidate, name)))}  ${name}`);
  await writeFile(path.join(candidate, 'runtime-archives-SHA256SUMS.txt'), `${archiveSums.join('\n')}\n`);
  await writeFile(path.join(candidate, 'candidate-provenance.json'), JSON.stringify({
    version: 1, releaseVersion, sourceCommit: runSha,
    workflowPath: workflowPathName, runId,
  }));

  // The real workflow shell blocks are evaluated verbatim. This generator
  // fixture models only the CLI contract: five archive/record pairs, the
  // recipe-to-patch digest binding, and manifest hashes derived from candidate
  // archive bytes. It has no network or external package dependencies.
  await writeFile(generator, `
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [version, directory, repo] = process.argv.slice(2);
const names = ${JSON.stringify(targets.map((entry) => entry[3]))};
const keys = ${JSON.stringify(targets.map((entry) => entry[0]))};
const platforms = ${JSON.stringify(targets.map((entry) => entry[1]))};
const arches = ${JSON.stringify(targets.map((entry) => entry[2]))};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const entries = await readdir(directory);
if(entries.length!==10 || names.some(n=>!entries.includes(n)||!entries.includes(n+'.build.json'))) throw new Error('expected exactly five runtime archive/build-record pairs');
const recipe=await readFile(path.join(repo,'script/ctg/build-owned-runtime.sh'),'utf8');
const patch=await readFile(path.join(repo,${JSON.stringify(combinedPatchPath)}));
const expected=recipe.match(/^EXPECTED_PATCH="([^"]+)"$/m)?.[1];
if(!expected || sha(patch)!==expected) throw new Error('recipe patch digest mismatch: expected='+expected+' actual='+sha(patch)+' path='+${JSON.stringify(combinedPatchPath)});
const runtimeSource=await readFile(path.join(repo,'lib/opencode/runtime.mjs'),'utf8');
const runtimePatch=runtimeSource.match(/CTG_RUNTIME_PATCH_SHA256 = '([a-f0-9]{64})'/)?.[1];
if(runtimePatch!==expected) throw new Error('fixture packaged runtime trust root patch digest mismatch');
const manifest={version:1,releaseVersion:version,compatibilityVersion:'2.0.32',runtimeVersion:'0.0.0-ctg.2.0.32',sourceRevision:'${sourceCommit}',patchSha256:expected,lockSha256:'${lockSha256}',assets:Object.fromEntries(keys.map((key,i)=>[key,{name:names[i],archiveSha256:'0'.repeat(64),executableSha256:'0'.repeat(64)}]))};
for(let i=0;i<names.length;i++) {
 const record=JSON.parse(await readFile(path.join(directory,names[i]+'.build.json'),'utf8'));
 if(record.target!==keys[i] || record.platform!==platforms[i] || record.arch!==arches[i] || record.sourceRevision!==manifest.sourceRevision || record.patchSha256!==expected || record.lockSha256!==manifest.lockSha256 || record.compatibilityVersion!==manifest.compatibilityVersion || record.runtimeVersion!==manifest.runtimeVersion) throw new Error('build record mismatch '+keys[i]);
 manifest.assets[keys[i]].archiveSha256=sha(await readFile(path.join(directory,names[i])));
 manifest.assets[keys[i]].executableSha256=record.executableSha256;
}
await writeFile(path.resolve(directory,'..','runtime-release.json.candidate'),JSON.stringify(manifest,null,2)+'\\n',{flag:'wx'});
`);

  const fakeGh = `#!/usr/bin/env node
import { copyFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
const a=process.argv.slice(2), q=a.indexOf('--jq')>=0?a[a.indexOf('--jq')+1]:'';
const run={status:'completed',conclusion:'success',event:'workflow_dispatch',head_repository:{full_name:'B-icy/Carthagent'},workflow_id:${workflowId},head_branch:'feature/reviewed-prebuild',head_sha:'${runSha}'};
if(a[0]==='api' && a[1].endsWith('/actions/runs/${runId}')) console.log(JSON.stringify(run));
else if(a[0]==='api' && a[1].endsWith('/actions/workflows/publish-owned-opencode-runtime.yml')) console.log('${workflowId}');
else if(a[0]==='api' && a[1]==='repos/B-icy/Carthagent') console.log('main');
else if(a[0]==='api' && a[1].endsWith('/git/ref/tags/${releaseTag}')) {
  if(q==='.object.sha') console.log('${tagObject}');
  else if(q==='.object.type') console.log('tag');
  else console.log(JSON.stringify({object:{sha:'${tagObject}',type:'tag'}}));
}
else if(a[0]==='api' && a[1].endsWith('/git/tags/${tagObject}')) {
  if(q==='.object.sha') console.log(process.env.FIXTURE_TAG_COMMIT||'${tagCommit}');
  else console.log(JSON.stringify({object:{sha:process.env.FIXTURE_TAG_COMMIT||'${tagCommit}',type:'commit'}}));
}
else if(a[0]==='api' && a[1].endsWith('/commits/${runSha}')) {
  if(q==='.sha') console.log('${runSha}'); else console.log(JSON.stringify({sha:'${runSha}'}));
}
else if(a[0]==='release' && a[1]==='view' && a.includes('isDraft')) console.log('true');
else if(a[0]==='release' && a[1]==='view' && a.includes('assets')) console.log('');
else if(a[0]==='release' && a[1]==='upload') {
  const item=a.find(x=>x.includes('#')); if(!item) throw new Error('missing upload source#name');
  const [src,name]=item.split('#'); await copyFile(src,path.join(process.env.FIXTURE_UPLOAD_CAPTURE,name));
  await appendFile(path.join(process.env.FIXTURE_UPLOAD_CAPTURE,'uploads.log'),name+'\\n');
} else { console.error('blocked unexpected fake gh invocation:',a.join(' ')); process.exit(97); }
`;
  const jqSource = `
let s=''; for await (const c of process.stdin) s+=c;
const expr=process.argv.at(-1), o=JSON.parse(s); let v=o;
if(expr==='.isDraft == true') { console.log(o.isDraft===true?'true':'false'); process.exit(0); }
if(expr==='[.assets[].name] | join("\\\\n")') { console.log((o.assets||[]).map(x=>x.name).join('\\\\n')); process.exit(0); }
if(expr==='.sha') { console.log(o.sha); process.exit(0); }
for(const k of expr.replace(/^\\./,'').split('.')) v=v[k];
console.log(v);
`;
  const fakeGhPath = path.join(fakeBin, 'fake-gh.mjs');
  const fakeJqPath = path.join(fakeBin, 'fake-jq.mjs');
  await writeFile(fakeGhPath, fakeGh);
  await writeFile(fakeJqPath, jqSource);
  await writeFile(path.join(fakeBin, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${fakeGhPath}" "$@"\n`);
  await writeFile(path.join(fakeBin, 'jq'), `#!/bin/sh\nexec "${process.execPath}" "${fakeJqPath}" "$@"\n`);
  await chmod(path.join(fakeBin, 'gh'), 0o755);
  await chmod(path.join(fakeBin, 'jq'), 0o755);
  return { directory, candidate, ctg, fakeBin, capture, manifestBytes };
}

function envFor(f, overrides = {}) {
  const nodeExecPath = process.env.CTG_WORKFLOW_TEST_NODE ?? process.execPath;
  const nodeDir = path.dirname(nodeExecPath);
  return {
    PATH: `${f.fakeBin}:${nodeDir}:/usr/bin:/bin`,
    NODE_PATH: '',
    BASH_ENV: '',
    ENV: '',
    HOME: f.directory,
    GITHUB_REPOSITORY: 'B-icy/Carthagent',
    GITHUB_WORKSPACE: f.directory,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: 'dddddddddddddddddddddddddddddddddddddddd',
    RELEASE_VERSION: releaseVersion,
    RELEASE_TAG: releaseTag,
    PREBUILD_RUN_ID: String(runId),
    FIXTURE_UPLOAD_CAPTURE: f.capture,
    GH_TOKEN: '',
    ...overrides,
  };
}

function runBlock(script, cwd, env) {
  const result = spawnSync('/usr/bin/bash', ['--noprofile', '--norc', '-e', '-u', '-o', 'pipefail', '-x', '-c', script], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return { ...result, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function assertSuccess(result, label) {
  assert.equal(result.error, undefined, `${label}: ${result.error?.message ?? ''}`);
  assert.equal(result.status, 0, `${label} failed (signal=${result.signal}):\n${result.output}`);
}

function assertFailure(result, label) {
  assert.equal(result.error, undefined, `${label}: ${result.error?.message ?? ''}`);
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded`);
}

async function runPublishFixture(f, { tagCommitSha = tagCommit, tamper = false } = {}) {
  const validateOutput = path.join(f.directory, 'validate-output');
  const verifyOutput = path.join(f.directory, 'verify-output');
  await writeFile(validateOutput, '');
  await writeFile(verifyOutput, '');
  if (tamper) await writeFile(path.join(f.candidate, targets[0][3]), Buffer.concat([await readFile(path.join(f.candidate, targets[0][3])), Buffer.from('tamper')]));
  const baseEnv = envFor(f, { FIXTURE_TAG_COMMIT: tagCommitSha });
  const validate = runBlock(validateBlock, f.directory, { ...baseEnv, MODE: 'publish', SOURCE_COMMIT: '', GITHUB_OUTPUT: validateOutput });
  assertSuccess(validate, 'publish validate block');
  const validated = await readFile(validateOutput, 'utf8');
  assert.match(validated, new RegExp(`release_commit=${tagCommitSha}`));

  const verify = runBlock(verifyBlock, f.directory, { ...baseEnv, GITHUB_OUTPUT: verifyOutput });
  if (tamper) {
    assertFailure(verify, 'tampered candidate verify block');
    assert.match(verify.output, /FAILED|does NOT match/);
    return { validate, verify, upload: undefined, verifyOutput };
  }
  assertSuccess(verify, 'publish verify block');
  assert.equal(await readFile(verifyOutput, 'utf8'), 'candidate=verified\n');
  const upload = runBlock(uploadBlock.replace('${{ needs.validate-request.outputs.release_commit }}', tagCommit), f.directory, baseEnv);
  if (tagCommitSha !== tagCommit) {
    assertFailure(upload, 'stale annotated tag upload block');
    return { validate, verify, upload, verifyOutput };
  }
  assertSuccess(upload, 'publish upload block');
  return { validate, verify, upload, verifyOutput };
}

test('owned-runtime publish workflow extracts executable YAML run blocks', () => {
  assert.match(validateBlock, /\[\[ "\$SOURCE_COMMIT" == "\$GITHUB_SHA" \]\]/);
  assert.match(validateBlock, /refs\/heads\/\$default_branch/);
  assert.match(verifyBlock, /candidate_dir=candidate/);
  assert.match(verifyBlock, /candidate=verified/);
  assert.match(uploadBlock, /candidate\/opencode-\$key/);
  assert.doesNotMatch(uploadBlock, /candidate-bytes/);
});

test('draft metadata validation has scoped write capability; artifact mutation stays in publish job', () => {
  const validation = workflowJob('validate-request');
  const prebuild = workflowJob('prebuild');
  const assembly = workflowJob('assemble-candidate');
  const publish = workflowJob('publish-existing-draft');
  assert.match(validation, /permissions:\n      actions: read\n      contents: write/);
  assert.match(validation, /gh release view "\$RELEASE_TAG".*--json isDraft/);
  assert.doesNotMatch(validation, /gh release upload/);
  assert.doesNotMatch(prebuild, /contents: write/);
  assert.doesNotMatch(assembly, /contents: write/);
  assert.match(publish, /contents: write/);
  assert.match(uploadBlock, /gh release upload/);
  assert.match(workflow, /git -C ctg show HEAD:docs\/patches\/opencode-v2\.0\.32-session-ui-combined-v2\.patch > opencode\/docs\/patches\/opencode-v2\.0\.32-session-ui-combined-v2\.patch/);
  assert.match(workflow, /patch_sha256="\$\(hash_file opencode\/docs\/patches\/opencode-v2\.0\.32-session-ui-combined-v2\.patch\)"/);
  assert.equal((workflow.match(/git -C ctg show HEAD:docs\/patches\/opencode-v2\.0\.32-session-ui-combined-v2\.patch > ctg\/docs\/patches\/opencode-v2\.0\.32-session-ui\.patch/g) ?? []).length, 2,
    'both generation paths must extract exact committed candidate bytes at the pinned historical path');
  assert.match(workflow, /git -C ctg show HEAD:script\/ctg\/build-owned-runtime\.sh > opencode\/script\/ctg\/build-owned-runtime\.sh/);
  assert.match(workflow, /chmod \+x opencode\/script\/ctg\/build-owned-runtime\.sh/);
  assert.match(workflow, /GIT_CONFIG_KEY_0:\s*core\.autocrlf[\s\S]*?GIT_CONFIG_VALUE_0:\s*'false'/);
  assert.match(workflow, /git -C opencode config --local core\.autocrlf false/);
  assert.match(workflow, /patch_sha256="\$\(hash_file opencode\/docs\/patches\/opencode-v2\.0\.32-session-ui-combined-v2\.patch\)"/);
});

test('review-branch prebuild source is exact dispatch SHA; publish validation is default-branch-only', { skip: requiresUbuntuWorkflowShell, timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  const out = path.join(f.directory, 'prebuild-output');
  await writeFile(out, '');
  const env = envFor(f, {
    MODE: 'prebuild',
    SOURCE_COMMIT: runSha,
    GITHUB_REF: 'refs/heads/feature/reviewed-prebuild',
    GITHUB_SHA: runSha,
    GITHUB_OUTPUT: out,
  });
  const allowed = runBlock(validateBlock, f.directory, env);
  assertSuccess(allowed, 'review-branch prebuild validation');
  assert.match(await readFile(out, 'utf8'), new RegExp(`source_commit=${runSha}`));

  const wrongSha = runBlock(validateBlock, f.directory, { ...env, SOURCE_COMMIT: tagCommit });
  assertFailure(wrongSha, 'prebuild with mismatched dispatch SHA');
  const publishOnReviewBranch = runBlock(validateBlock, f.directory, {
    ...envFor(f, { MODE: 'publish', SOURCE_COMMIT: '', GITHUB_REF: 'refs/heads/feature/reviewed-prebuild', GITHUB_OUTPUT: out }),
  });
  assertFailure(publishOnReviewBranch, 'publish validation from non-default branch');
});

test('positive publish verifies five archive bytes and fake-captures exactly seven identical assets', { skip: requiresUbuntuWorkflowShell, timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  const result = await runPublishFixture(f);
  assertSuccess(result.upload, 'fake upload');
  const uploaded = (await readFile(path.join(f.capture, 'uploads.log'), 'utf8')).trim().split('\n').sort();
  assert.deepEqual(uploaded, [
    'opencode-darwin-arm64.tar.gz', 'opencode-darwin-x64.tar.gz',
    'opencode-linux-arm64.tar.gz', 'opencode-linux-x64.tar.gz',
    'opencode-windows-x64.tar.gz', 'runtime-release-SHA256SUMS.txt', 'runtime-release.json',
  ]);
  for (const [, , , name] of targets) {
    assert.deepEqual(await readFile(path.join(f.capture, name)), await readFile(path.join(f.candidate, name)));
  }
  assert.deepEqual(await readFile(path.join(f.capture, 'runtime-release.json')), f.manifestBytes);
  const sums = (await readFile(path.join(f.capture, 'runtime-release-SHA256SUMS.txt'), 'utf8')).trim().split('\n');
  assert.equal(sums.length, 6);
  for (const line of sums) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    assert.ok(match, `checksum line should be sha256sum-formatted: ${line}`);
    assert.equal(match[1], sha256(await readFile(path.join(f.capture, match[2]))), `checksum for ${match[2]}`);
  }
});

test('tampered candidate archive is rejected before any fake upload', { skip: requiresUbuntuWorkflowShell, timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  const result = await runPublishFixture(f, { tamper: true });
  assert.equal(result.upload, undefined);
  assert.deepEqual(await (await import('node:fs/promises')).readdir(f.capture), []);
});

test('stale annotated tag is rejected by upload recheck before any fake upload', { skip: requiresUbuntuWorkflowShell, timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  const result = await runPublishFixture(f, { tagCommitSha: 'dddddddddddddddddddddddddddddddddddddddd' });
  assertFailure(result.upload, 'stale-tag upload recheck');
  assert.deepEqual(await (await import('node:fs/promises')).readdir(f.capture), []);
});
