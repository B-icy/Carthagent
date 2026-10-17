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
    compatibilityVersion: fields.compatibilityVersion ?? fields.binaryVersion,
    runtimeVersion: fields.runtimeVersion ?? fields.binaryVersion,
    runtimeSourceRevision: fields.runtimeSourceRevision,
    runtimePatchSha256: fields.runtimePatchSha256,
    runtimeLockSha256: fields.runtimeLockSha256,
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
    identityRequirement: 'binaryVersion and compatibilityVersion are the exact compatibility contract 2.0.32; runtimeVersion is captured separately from exact native runtime --version and exact server.info.version. Owned binaries require loadNativeTestRuntime with the trusted release manifest (default lib/opencode/runtime-release.json or CTG_TEST_RUNTIME_RELEASE_MANIFEST) and optional CTG_TEST_RUNTIME_SHA256; adjacent ctg-runtime.json is provenance only, never the trust source.',
    sustainedMemoryAcceptance: 'plan proposal only, not authorized: serial baseline and CTG conditions; each warms 5 minutes, then records exactly 25 minutes of 1-second RSS under the same disposable loopback streaming/reconnect workload. Align elapsed-time samples; any missing/unmatched point fails without interpolation. Combined TUI+owned-server RSS: B0/C0 are first-measured-5-minute medians; D(t)=(CTG(t)-C0)-(baseline(t)-B0). Proposed retained-growth gate max D<=128 MiB across 25 minutes; proposed observable-plateau gate final-5-minute median D minus first-measured-5-minute median D<=32 MiB. Preserve separate TUI/server/combined raw traces. Finite-window engineering criteria, not mathematical long-term guarantees; parent/product review of formula, workload, and failure policy required before authorization.',
    workspaceUiAcceptance: 'the native compatibility target includes cached /ctg-workspace UI load <=300ms; a strict post-submit PTY route/data-render observation is required, RPC-only timing does not satisfy it',
    sustainedMemoryDiagnosticDesign: 'plan only; serial baseline/CTG, 5-minute warmup plus 25 minutes of 1-second samples under the same disposable loopback streaming/reconnect workload. Align elapsed-time points and fail on any missing/unmatched sample; retain TUI/server/combined RSS, host load/memory, stream/reconnect/error counts and cleanup. Proposed combined-RSS statistic and 128/32 MiB thresholds are fully specified in sustainedMemoryAcceptance and require separate parent/product review before any run.',
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
