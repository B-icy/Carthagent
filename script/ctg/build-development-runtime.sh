#!/usr/bin/env bash
set -euo pipefail

# Local candidate recipe. Published release inputs remain independently pinned.
# Usage: bash script/ctg/build-development-runtime.sh /path/to/pristine/upstream
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE="${1:?Pass a pristine checkout of the pinned upstream revision}"
EXPECTED_LOCK="9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d"
[[ "$(bun --version)" == "1.4.2" ]] || { echo 'Expected Bun 1.4.2' >&2; exit 1; }
bash "$ROOT/script/ctg/prepare-development-runtime.sh" "$SOURCE"
cd "$SOURCE"
SOURCE="$(pwd)"
node --input-type=module - "$EXPECTED_LOCK" <<'NODE'
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
if (createHash('sha256').update(readFileSync('bun.lock')).digest('hex') !== process.argv[2]) throw new Error('Pinned lock checksum mismatch');
NODE
bun install --frozen-lockfile
# A bounded compiler worker avoids host CPU-count based memory oversubscription.
for package in core server plugin client tui cli; do
  (cd "packages/$package" && bun x tsgo -b --singleThreaded)
done
bun test --cwd packages/core test/session-compaction.test.ts test/shell-retention.test.ts
bun test --cwd packages/server test/shell-provenance.test.ts test/fs.test.ts test/integration-startup.test.ts
bun test --cwd packages/cli test/carthagent-reconnect.test.ts
bun test --cwd packages/theme test/theme.test.ts
bun test --cwd packages/tui --timeout 60000
node "$ROOT/tools/run-native-test-stress.mjs" 10 180000 bun test --cwd packages/tui --timeout 60000 test/navigation-rail.test.tsx
node "$ROOT/tools/run-native-test-stress.mjs" 10 180000 bun test --cwd packages/tui --timeout 60000 test/component/seascape-render.test.tsx
PLATFORM="$(node -p 'process.platform === "win32" ? "windows" : process.platform')-$(node -p 'process.arch')"
TARGET="opencode-$PLATFORM"
(cd packages/cli && OPENCODE_VERSION=0.0.0-ctg.2.0.32 OPENCODE_CHANNEL=ctg.2.0.32 bun run script/build.ts --single --target="$TARGET" --skip-web-ui --outdir="$SOURCE/packages/cli/dist-ctg")
cp LICENSE packages/cli/dist-ctg/LICENSE
node --input-type=module - "$ROOT" "$PLATFORM" "$EXPECTED_LOCK" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const [root, platform, lockSha256] = process.argv.slice(2);
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const preparation = readFileSync(`${root}/script/ctg/prepare-development-runtime.sh`, 'utf8');
const patch = preparation.match(/PATCH_FILE="\$ROOT\/(.+)"/)[1];
const patchSha256 = hash(`${root}/${patch}`);
const binary = `cli-${platform}/bin/opencode${platform.startsWith('windows-') ? '.exe' : ''}`;
const directory = 'packages/cli/dist-ctg';
const version = execFileSync(`${directory}/${binary}`, ['--version'], { encoding: 'utf8' }).trim();
if (version !== 'opencode v0.0.0-ctg.2.0.32') throw new Error(`Unexpected runtime: ${version}`);
writeFileSync(`${directory}/SHA256SUMS`, `${hash(`${directory}/${binary}`)}  ${binary}\n`);
writeFileSync(`${directory}/ctg-runtime.json`, JSON.stringify({ owner: 'Carthagent', sourceRepository: 'https://github.com/anomalyco/opencode', sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), lockSha256, patchSha256, compatibilityVersion: '2.0.32', runtimeVersion: '0.0.0-ctg.2.0.32', channel: 'ctg.2.0.32', platform, webUI: false }, null, 2) + '\n');
console.log(`Development candidate: ${directory}/${binary}`);
NODE
