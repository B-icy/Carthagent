#!/usr/bin/env bash
set -euo pipefail

# Reproducible Linux build for CTG's separately named OpenCode v2.0.32 runtime.
# Run from a clean checkout of the locked source revision with Bun 1.4.2.
ROOT="$(git rev-parse --show-toplevel)"
EXPECTED_SOURCE="843a6c514e606b436a7fe713422ace0a93ad3d61"
EXPECTED_PATCH="ade9079bd454087c7fcac6fb3c85bc31636e4bd10a886baafd3c7446e6631788"
TARGET="${1:-opencode-linux-x64}"
HOST_PLATFORM="$(node -p 'process.platform')"
HOST_ARCH="$(node -p 'process.arch')"

cd "$ROOT"
if [[ "$(git rev-parse HEAD)" != "$EXPECTED_SOURCE" ]]; then
  echo "Expected pristine OpenCode source $EXPECTED_SOURCE; got $(git rev-parse HEAD)" >&2
  exit 1
fi
if [[ "$(bun --version)" != "1.4.2" ]]; then
  echo "Expected Bun 1.4.2; got $(bun --version)" >&2
  exit 1
fi

patch_file="$ROOT/docs/patches/opencode-v2.0.32-session-ui.patch"
actual_patch="$(sha256sum "$patch_file" | awk '{print $1}')"
if [[ "$actual_patch" != "$EXPECTED_PATCH" ]]; then
  echo "Patch checksum mismatch: $actual_patch" >&2
  exit 1
fi
git apply --check "$patch_file"
git apply "$patch_file"

echo "source=$(git rev-parse HEAD)"
echo "patch_sha256=$actual_patch"
echo "license=$(grep -m1 '"license"' packages/cli/package.json | cut -d '"' -f4)"

bun install --frozen-lockfile
bun run --cwd packages/core typecheck
bun run --cwd packages/server typecheck
bun run --cwd packages/plugin typecheck
bun run --cwd packages/client typecheck
bun run --cwd packages/tui typecheck
bun test --cwd packages/core test/session-compaction.test.ts
bun test --cwd packages/core test/shell-retention.test.ts
bun test --cwd packages/tui test/clear-session.test.tsx
bun test --cwd packages/tui test/util/renderer.test.ts

cd packages/cli
# A CTG build is intentionally detached from upstream updater channels and
# receives an explicit non-upstream identity; it must never masquerade as 2.0.32.
if [[ "$TARGET" == opencode-windows-* ]]; then
  BUILD_OS=win32
  BINARY=opencode.exe
elif [[ "$TARGET" == opencode-darwin-* ]]; then
  BUILD_OS=darwin
  BINARY=opencode
else
  BUILD_OS=linux
  BINARY=opencode
fi
BUILD_ARCH="$(sed -E 's/^opencode-(linux|darwin|windows)-([^-]+).*$/\2/' <<< "$TARGET")"
if [[ "$BUILD_OS" != "$HOST_PLATFORM" || "$BUILD_ARCH" != "$HOST_ARCH" ]]; then
  echo "Cross-compiling target $TARGET is not supported by this recipe; run on matching native CI (host $HOST_PLATFORM-$HOST_ARCH)" >&2
  exit 1
fi
OPENCODE_VERSION=0.0.0-ctg.2.0.32 OPENCODE_CHANNEL=ctg.2.0.32 \
  bun run script/build.ts --single --target="$TARGET" --skip-web-ui --outdir="$ROOT/packages/cli/dist-ctg"

cd "$ROOT"
artifact="${TARGET#opencode-}"
binary="$ROOT/packages/cli/dist-ctg/cli-$artifact/bin/$BINARY"
test -x "$binary"
"$binary" --version
cp "$ROOT/LICENSE" "$ROOT/packages/cli/dist-ctg/LICENSE"
relative_binary="cli-$artifact/bin/$BINARY"
cd "$ROOT/packages/cli/dist-ctg"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$relative_binary" | tee SHA256SUMS
else
  shasum -a 256 "$relative_binary" | tee SHA256SUMS
fi
cat > ctg-runtime.json <<EOF
{
  "owner": "Carthagent",
  "sourceRepository": "https://github.com/anomalyco/opencode",
  "sourceRevision": "$EXPECTED_SOURCE",
  "patchSha256": "$EXPECTED_PATCH",
  "compatibilityVersion": "2.0.32",
  "runtimeVersion": "0.0.0-ctg.2.0.32",
  "channel": "ctg.2.0.32",
  "platform": "$artifact",
  "webUI": false
}
EOF
