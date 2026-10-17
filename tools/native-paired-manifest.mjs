/** Serialize paired-run provenance with JSON's typed, escaped representation. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
export function createPairedManifest(fields) {
  const sourceCheckoutDirtyStatus = fields.sourceCheckoutDirtyStatus ?? '';
  const harnessDirtyStatus = fields.harnessDirtyStatus ?? '';
  const manifest = {
    createdAt: fields.createdAt,
    binary: fields.binary,
    binaryVersion: fields.binaryVersion,
    binarySha256: fields.binarySha256,
    expectedHostVersion: '2.0.32',
    sourceCheckout: fields.sourceCheckout,
    sourceCheckoutHead: fields.sourceCheckoutHead,
    sourceCheckoutDirty: sourceCheckoutDirtyStatus.length > 0,
    sourceCheckoutDirtyStatus,
    sourceCheckoutStatusSha256: createHash('sha256').update(sourceCheckoutDirtyStatus).digest('hex'),
    sourceCommit: fields.sourceCommit,
    sourceTree: fields.sourceTree,
    sourceDirty: false,
    sourceSnapshotTar: fields.sourceSnapshotTar,
    sourceArchiveSha256: fields.sourceArchiveSha256,
    executionSnapshotTar: fields.executionSnapshotTar,
    executionSnapshotSha256: fields.executionSnapshotSha256,
    sourceSnapshotSha256: fields.sourceSnapshotSha256,
    packageLockSha256: fields.packageLockSha256,
    installedPackageLockSha256: fields.installedPackageLockSha256,
    dependencyNodeModulesRealpath: fields.dependencyNodeModulesRealpath,
    dependencyInstallSha256: fields.dependencyInstallSha256,
    dependencyInstallRealpath: fields.dependencyInstallRealpath,
    dependencyPackages: fields.dependencyPackages,
    harnessWorktree: fields.harnessWorktree,
    harnessCommit: fields.harnessCommit,
    harnessDirty: harnessDirtyStatus.length > 0,
    harnessDirtyStatus,
    harnessSourceManifestSha256: fields.harnessSourceManifestSha256,
    order: ['baseline-1', 'ctg-1', 'ctg-2', 'baseline-2'],
    samplesPerRun: fields.samplesPerRun,
    warmup: 'one input key excluded; both switch destinations visited before measured alternating switches',
    terminal: '36 rows x 120 columns',
    thresholds: { inputP95Ms: 50, switchP95Ms: 150, workspaceRenderMs: 300 },
    measurementScope: 'keypress or Enter through select/read/VT parsing to parsed PTY screen evidence; not compositor/GPU presentation; no observer-overhead subtraction',
    hostSampling: 'one-second load-average and MemAvailable observations throughout each run\'s switch/input window',
    pairedConditions: 'one condition server at a time; fresh disposable profiles/databases with equivalent same-project session titles/prompts/markers; same pinned binary and 36x120 PTY; CTG loaded from complete selected source archive',
    pluginRequirement: 'the raw native plugin.list inventory must show carthagent active plus health RPC for CTG; no carthagent id or namespace for baseline; state is observed, never inferred from the mode flag',
    sustainedMemoryAcceptance: 'parent-proposed, not yet reviewed or authorized: 30-minute offline comparison; each condition has 5-minute warmup then 25 minutes of 1-second RSS samples; proposed CTG incremental retained growth over baseline <=128 MiB and final measured 5-minute median growth relative to the first measured 5-minute block <=32 MiB; separately retain TUI/server RSS and combined; exact calculation, alignment, workload, and missing-sample policy require separate review; not a mathematical long-term bound',
    workspaceUiAcceptance: 'the native compatibility target includes cached /ctg-workspace UI load <=300ms; a strict post-submit PTY route/data-render observation is required, RPC-only timing does not satisfy it',
    sustainedMemoryDiagnosticDesign: 'parent-proposed bounded offline comparison, not yet authorized: baseline and CTG each warm 5 minutes then sample 25 minutes at 1 second; retain independent TUI/server process-tree RSS, combined RSS, host load/memory, PTY/stream/reconnect/errors/missing samples/cleanup; preserve both raw condition series; exact elapsed-time alignment, subtraction, missing-sample policy, and workload require separate parent review',
    sourceComponentSha256: fields.sourceComponentSha256,
    harnessComponentSha256: fields.harnessComponentSha256,
    acceptance: 'diagnostic until operator confirms controlled window and independent review; thresholds unchanged',
  };
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = await new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { value += chunk; });
    process.stdin.on('end', () => resolve(value));
    process.stdin.on('error', reject);
  });
  process.stdout.write(`${JSON.stringify(createPairedManifest(JSON.parse(input)), null, 2)}\n`);
}
