# Generating the owned runtime release manifest

`tools/generate-owned-runtime-release.mjs` converts the five native build outputs into a candidate `lib/opencode/runtime-release.json` trust root. It does not build binaries, publish artifacts, update a release, or commit the candidate.

## Input directory contract

The assets directory must contain exactly these ten regular files (no extra files or subdirectories):

- `opencode-linux-x64.tar.gz` and `opencode-linux-x64.tar.gz.build.json`
- `opencode-linux-arm64.tar.gz` and `opencode-linux-arm64.tar.gz.build.json`
- `opencode-darwin-x64.tar.gz` and `opencode-darwin-x64.tar.gz.build.json`
- `opencode-darwin-arm64.tar.gz` and `opencode-darwin-arm64.tar.gz.build.json`
- `opencode-windows-x64.tar.gz` and `opencode-windows-x64.tar.gz.build.json`

Each archive must be a USTAR gzip artifact in the layout consumed by `lib/opencode/runtime-artifact.mjs`. Inspection of the native build output shows the expected runtime tree includes the root `LICENSE`, `SHA256SUMS`, `ctg-runtime.json`, `cli-<target>/package.json`, and `cli-<target>/bin/opencode` (or `.exe` on Windows), plus only their parent directories. The generator accepts this complete build output, validates target package name/version/OS/CPU, and rejects unexpected files/directories inside the runtime archive. The source-recipe archives are not runtime archives and are not passed to this generator. The adjacent build record is JSON with this exact identity contract (additional fields are tolerated):

```json
{
  "version": 1,
  "target": "linux-x64",
  "platform": "linux",
  "arch": "x64",
  "sourceRevision": "<40-character pinned source commit>",
  "patchSha256": "<64-character digest>",
  "lockSha256": "<64-character digest>",
  "compatibilityVersion": "2.0.32",
  "runtimeVersion": "0.0.0-ctg.2.0.32",
  "executableSha256": "<64-character digest of the built executable>"
}
```

The record is not trusted by itself. The generator takes the expected source, patch, lock, compatibility, and runtime identity from the reviewed prebuild recipe; verifies the patch bytes; computes each archive digest from the exact archive bytes; then supplies the record's executable digest and pinned provenance to the approved runtime acquisition API. That API parses the USTAR archive, checks embedded provenance, checks `SHA256SUMS`, and hashes the actual extracted executable. Any mismatch aborts generation.

The generator emits the agreed outer schema with exactly five asset entries. It writes a new candidate file atomically and refuses to overwrite an existing candidate; review or remove a previous candidate explicitly before another generation. The supplied `releaseVersion` is the planned canonical semantic version; the final tagged-package gate must compare it with the final package's version.

Example invocation after downloading the five archives and records from the native build jobs:

```sh
node tools/generate-owned-runtime-release.mjs 1.2.3 ./runtime-assets .
```

This writes `./runtime-release.json.candidate` next to `./runtime-assets`. The asset producer owns wiring the output into its own CI handoff. Do not check in dummy/sample digests as a production manifest.
