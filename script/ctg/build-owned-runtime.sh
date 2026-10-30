#!/usr/bin/env bash
set -euo pipefail

# Reproducible native build for CTG's separately named OpenCode v2.0.32 runtime.
# Run from a clean checkout of the locked source revision with Bun 1.4.2.
ROOT="$(git rev-parse --show-toplevel)"
EXPECTED_SOURCE="843a6c514e606b436a7fe713422ace0a93ad3d61"
EXPECTED_LOCK="9d78379cd264584a495440a217b9d2ecab524c9a56f7f8b4b5bed3926daa330d"
EXPECTED_PATCH="1f2309bb3a31dfb8e8a0827a6a1144a1f76a005abff58f6f48857639ec02478a"
TARGET="${1:-opencode-linux-x64}"
HOST_PLATFORM="$(node -p 'process.platform')"
HOST_ARCH="$(node -p 'process.arch')"

cd "$ROOT"
if command -v sha256sum >/dev/null 2>&1; then
  HASH_COMMAND=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  HASH_COMMAND=(shasum -a 256)
else
  echo "Need sha256sum or shasum to verify pinned inputs" >&2
  exit 1
fi
if [[ "$(git rev-parse HEAD)" != "$EXPECTED_SOURCE" ]]; then
  echo "Expected pristine OpenCode source $EXPECTED_SOURCE; got $(git rev-parse HEAD)" >&2
  exit 1
fi
# Reject staged edits and every tracked worktree edit other than a bun.lock
# line-ending conversion before restoring anything. On Windows, validate that
# normalizing CRLF to LF exactly reproduces the committed blob; this keeps
# checkout conversion distinct from user edits and fails closed on content
# changes. The blob itself must still match the pinned lock hash.
if ! git diff --cached --quiet HEAD --; then
  echo "Refusing to build with staged source changes" >&2
  exit 1
fi
expected_inputs=(
  "docs/patches/opencode-v2.0.32-session-ui-combined-v4.patch"
  "script/ctg/build-owned-runtime.sh"
)
actual_status="$(git status --porcelain --untracked-files=all)"
unexpected=""
while IFS= read -r entry; do
  [[ -z "$entry" ]] && continue
  path="${entry:3}"
  allowed=false
  for input in "${expected_inputs[@]}"; do
    [[ "$path" == "$input" ]] && allowed=true
  done
  if [[ "$allowed" != true && "$path" != "bun.lock" ]]; then
    unexpected+="${entry}"$'\n'
  fi
done <<< "$actual_status"
if [[ -n "$unexpected" ]]; then
  echo "Expected pristine tracked source and only the two reviewed CTG build inputs as untracked files" >&2
  git status --short >&2
  exit 1
fi
if ! git diff --quiet HEAD -- . ':(exclude)bun.lock'; then
  echo "Refusing to build with modified tracked source files" >&2
  git status --short >&2
  exit 1
fi
node - "$EXPECTED_LOCK" <<'NODE'
const { createHash } = require("node:crypto")
const { execFileSync } = require("node:child_process")
const { readFileSync } = require("node:fs")
const expectedHash = process.argv[2]
const committed = execFileSync("git", ["show", "HEAD:bun.lock"])
const current = readFileSync("bun.lock")
const normalized = Buffer.from(current.toString("utf8").replace(/\r\n/g, "\n"))
const hash = createHash("sha256").update(committed).digest("hex")
if (hash !== expectedHash || !normalized.equals(committed)) {
  console.error("Refusing to restore bun.lock: tracked content differs from the pinned blob")
  process.exit(1)
}
NODE
# Only after the fail-closed pristine check, restore Windows checkout line
# endings with conversion disabled so Bun sees the exact committed bytes.
git -c core.autocrlf=false checkout-index --force -- bun.lock
if [[ "$("${HASH_COMMAND[@]}" bun.lock | awk '{print $1}')" != "$EXPECTED_LOCK" ]]; then
  echo "Pinned bun.lock checksum mismatch" >&2
  exit 1
fi
if [[ "$(bun --version)" != "1.4.2" ]]; then
  echo "Expected Bun 1.4.2; got $(bun --version)" >&2
  exit 1
fi

patch_file="$ROOT/docs/patches/opencode-v2.0.32-session-ui-combined-v4.patch"
actual_patch="$("${HASH_COMMAND[@]}" "$patch_file" | awk '{print $1}')"
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
bun test --cwd packages/server test/shell-provenance.test.ts
bun test --cwd packages/tui test/plugin-source.test.ts
bun test --cwd packages/tui test/clear-session.test.tsx
bun test --cwd packages/tui --timeout 30000 test/navigation-rail.test.tsx --rerun-each 10
bun test --cwd packages/tui --timeout 30000 test/component/seascape-render.test.tsx --rerun-each 10
bun test --cwd packages/tui --timeout 30000 test/app-lifecycle.test.tsx test/session-panel.test.tsx
bun test --cwd packages/tui test/util/renderer.test.ts
bun test --cwd packages/tui test/component/plan-view.test.tsx test/component/transcript-scrollbox.test.ts test/component/seascape.test.ts test/component/session-tabs-rail.test.tsx test/component/session-tabs-marquee.test.ts test/component/session-tabs-mouse.test.tsx test/context/session-tabs-model.test.ts test/ui/layout.test.ts
bun test --cwd packages/tui --timeout 60000 test/glyphs.test.ts test/plugin-keymap.test.tsx test/plugin-theme.test.tsx test/plugin-theme-provider.test.tsx

cd packages/cli
# A CTG build is intentionally detached from upstream updater channels and
# receives an explicit non-upstream identity; it must never masquerade as 2.0.32.
if [[ "$TARGET" == opencode-windows-* ]]; then
  BUILD_OS=win32
  MANIFEST_PLATFORM="windows-${TARGET#opencode-windows-}"
  BINARY=opencode.exe
elif [[ "$TARGET" == opencode-darwin-* ]]; then
  BUILD_OS=darwin
  MANIFEST_PLATFORM="darwin-${TARGET#opencode-darwin-}"
  BINARY=opencode
else
  BUILD_OS=linux
  MANIFEST_PLATFORM="linux-${TARGET#opencode-linux-}"
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
"${HASH_COMMAND[@]}" "$relative_binary" | tee SHA256SUMS
cat > ctg-runtime.json <<EOF
{
  "owner": "Carthagent",
  "sourceRepository": "https://github.com/anomalyco/opencode",
  "sourceRevision": "$EXPECTED_SOURCE",
  "lockSha256": "$EXPECTED_LOCK",
  "patchSha256": "$EXPECTED_PATCH",
  "compatibilityVersion": "2.0.32",
  "runtimeVersion": "0.0.0-ctg.2.0.32",
  "channel": "ctg.2.0.32",
  "platform": "$MANIFEST_PLATFORM",
  "webUI": false
}
EOF
