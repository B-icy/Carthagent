#!/bin/sh
# Run the Carthagent sidebar source preview: the patched OpenCode source CLI with
# this checkout's Carthagent plugin, in an isolated private profile.
#
# This is a development preview from source. It does not build, install, or
# replace the published ctg runtime, and it never reads ordinary profiles.
set -eu
umask 077
unset CDPATH

usage() {
  cat <<'EOF'
Usage: script/ctg/source-preview.sh --source DIR --profile DIR --bun PATH [--workspace DIR] [-- OPENCODE-ARGS...]

  --source DIR     OpenCode checkout at the pinned upstream with the development
                   patch applied and `bun install` completed.
  --profile DIR    Private profile directory (created 0700 if missing). Holds the
                   isolated home, config, data (sessions, auth), cache and state.
  --bun PATH       Bun executable matching the source packageManager pin.
  --workspace DIR  Folder to open (default: current directory).
  -- ARGS...       Run another OpenCode command instead, e.g. `-- auth login`.
                   --standalone is added when absent; --server is rejected.

Relative paths resolve against the current directory. Existing profile files are
never overwritten. The source CLI starts its own private loopback server on an
ephemeral port, which exits with the TUI.
EOF
}

fail() { printf 'source-preview: %s\n' "$1" >&2; exit "${2:-1}"; }

absolute_dir() { (cd -- "$1" 2>/dev/null && pwd); }

source_arg='' profile_arg='' bun_arg='' workspace_arg='' forwarded=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --source|--profile|--bun|--workspace)
      [ "$#" -ge 2 ] || fail "$1 requires a value" 2
      case "$1" in
        --source) source_arg=$2 ;;
        --profile) profile_arg=$2 ;;
        --bun) bun_arg=$2 ;;
        --workspace) workspace_arg=$2 ;;
      esac
      shift 2 ;;
    --) shift; forwarded=1; break ;;
    *) fail "Unknown option: $1 (see --help)" 2 ;;
  esac
done

[ -n "$source_arg" ] || fail '--source is required (see --help)' 2
[ -n "$profile_arg" ] || fail '--profile is required (see --help)' 2
[ -n "$bun_arg" ] || fail '--bun is required (see --help)' 2

source_dir=$(absolute_dir "$source_arg") || fail "source $source_arg is not a directory" 2
cli_dir="$source_dir/packages/cli"
[ -f "$cli_dir/src/index.ts" ] || fail "source $source_dir has no packages/cli/src/index.ts; pass the patched OpenCode checkout root" 2

bun_parent=$(absolute_dir "$(dirname -- "$bun_arg")") || fail "bun $bun_arg is not executable" 2
bun="$bun_parent/$(basename -- "$bun_arg")"
[ -f "$bun" ] && [ -x "$bun" ] || fail "bun $bun_arg is not executable" 2

if [ "$forwarded" -eq 0 ]; then
  workspace=$(absolute_dir "${workspace_arg:-.}") || fail "workspace ${workspace_arg:-.} is not a directory" 2
fi

standalone=0
for arg in "$@"; do
  case "$arg" in
    --server|--server=*) fail '--server is not supported: the preview always uses a private --standalone server' 2 ;;
    --standalone) standalone=1 ;;
  esac
done

[ -d "$source_dir/node_modules" ] || fail "source dependencies are missing; run \`$bun install\` in $source_dir first"

pin=$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"bun@\([^"]*\)".*/\1/p' "$source_dir/package.json" 2>/dev/null | head -n 1)
if [ -n "$pin" ]; then
  version=$("$bun" --version 2>/dev/null) || fail "could not run $bun --version"
  [ "$version" = "$pin" ] || fail "source requires bun $pin; $bun reports $version"
fi

script_dir=$(absolute_dir "$(dirname -- "$0")") || fail 'cannot locate the launcher directory'
product_root=$(absolute_dir "$script_dir/../..") || fail 'cannot locate the Carthagent checkout'
plugin="$product_root/plugins/carthagent"
[ -f "$plugin/package.json" ] || fail "Carthagent plugin not found at $plugin"

new_profile=0
if [ ! -d "$profile_arg" ]; then
  mkdir -p -- "$profile_arg"
  new_profile=1
fi
profile=$(absolute_dir "$profile_arg") || fail "profile $profile_arg is not a directory" 2
# BSD chmod does not accept `--` after the mode; an absolute operand cannot be read as an option.
[ "$new_profile" -eq 0 ] || chmod 700 "$profile"
config="$profile/config/opencode"
mkdir -p -- "$profile/home" "$profile/tmp" "$profile/data" "$profile/cache" "$profile/state" "$config/themes"

# Create missing files exclusively (noclobber) so a concurrent or existing file always wins.
create_once() {
  [ -e "$1" ] && return 0
  (set -C; cat > "$1") 2>/dev/null || [ -e "$1" ]
}
json_plugin=$(printf '%s' "$plugin" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '{\n  "$schema": "https://opencode.ai/config.json",\n  "plugins": [\n    "%s"\n  ]\n}\n' "$json_plugin" | create_once "$config/opencode.json"
printf '{\n  "theme": {\n    "name": "carthage",\n    "mode": "dark"\n  }\n}\n' | create_once "$config/cli.json"
create_once "$config/themes/carthage.json" < "$plugin/themes/carthage.json"
physical_plugin=$(cd -- "$plugin" && pwd -P)
grep -F -q -e "$json_plugin" -e "$physical_plugin" "$config/opencode.json" \
  || printf 'source-preview: warning: %s does not reference the Carthagent plugin at %s; leaving it unchanged\n' "$config/opencode.json" "$plugin" >&2

if [ "$forwarded" -eq 0 ]; then
  set -- --standalone "$workspace"
elif [ "$standalone" -eq 0 ]; then
  set -- "$@" --standalone
fi

node_dir=''
if node_path=$(command -v node 2>/dev/null); then node_dir=$(dirname -- "$node_path"); fi

cd -- "$cli_dir"
exec env -i \
  HOME="$profile/home" \
  PATH="$bun_parent:${node_dir:+$node_dir:}/usr/bin:/bin" \
  TERM="${TERM:-xterm-256color}" COLORTERM="${COLORTERM:-truecolor}" \
  TMPDIR="$profile/tmp" \
  XDG_CONFIG_HOME="$profile/config" XDG_DATA_HOME="$profile/data" \
  XDG_CACHE_HOME="$profile/cache" XDG_STATE_HOME="$profile/state" \
  OPENCODE_CONFIG_DIR="$config" OPENCODE_TEST_HOME="$profile/home" \
  OPENCODE_DISABLE_PROJECT_CONFIG=1 OPENCODE_DISABLE_AUTOUPDATE=1 \
  BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 \
  "$bun" --no-env-file run src/index.ts "$@"
