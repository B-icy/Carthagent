#!/usr/bin/env bash
set -euo pipefail

# Prepare development OpenCode source for CTG by applying the reviewed
# development patch to an explicitly supplied clean checkout of the locked
# upstream revision. This only checks inputs and applies the patch: it does not
# install, compile, or publish. Published releases are still built from the
# published patch by script/ctg/build-owned-runtime.sh.
#
# Usage: script/ctg/prepare-development-runtime.sh /path/to/clean/opencode-checkout
EXPECTED_SOURCE="843a6c514e606b436a7fe713422ace0a93ad3d61"
EXPECTED_PATCH="59c57b375c6c9b0895c5f5727827f4e1fee1008ee4b625550bb1d458b8341905"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PATCH_FILE="$ROOT/docs/patches/opencode-v2.0.32-session-ui-combined-v5.patch"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/clean/opencode-checkout" >&2
  exit 2
fi
SOURCE="$1"

if command -v sha256sum >/dev/null 2>&1; then
  HASH_COMMAND=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  HASH_COMMAND=(shasum -a 256)
else
  echo "Need sha256sum or shasum to verify the development patch" >&2
  exit 1
fi

if [[ "$(git -C "$SOURCE" rev-parse HEAD)" != "$EXPECTED_SOURCE" ]]; then
  echo "Expected OpenCode source $EXPECTED_SOURCE; got $(git -C "$SOURCE" rev-parse HEAD)" >&2
  exit 1
fi
if [[ -n "$(git -C "$SOURCE" status --porcelain --untracked-files=all)" ]]; then
  echo "Refusing to prepare a checkout with staged, modified, or untracked files" >&2
  git -C "$SOURCE" status --short >&2
  exit 1
fi

actual_patch="$("${HASH_COMMAND[@]}" "$PATCH_FILE" | awk '{print $1}')"
if [[ "$actual_patch" != "$EXPECTED_PATCH" ]]; then
  echo "Development patch checksum mismatch: $actual_patch" >&2
  exit 1
fi

git -C "$SOURCE" apply --check "$PATCH_FILE"
git -C "$SOURCE" apply "$PATCH_FILE"

echo "source=$EXPECTED_SOURCE"
echo "patch=docs/patches/opencode-v2.0.32-session-ui-combined-v5.patch"
echo "patch_sha256=$actual_patch"
