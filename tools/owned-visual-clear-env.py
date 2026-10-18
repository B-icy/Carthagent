"""Platform-neutral child-environment allowlist for the owned visual-clear probe."""
from pathlib import Path

SAFE_PARENT_ENV = ('PATH', 'LANG', 'LC_ALL')
SAFE_WINDOWS_ENV = ('SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT')
TUI_ENV_KEYS = frozenset((*SAFE_PARENT_ENV, *SAFE_WINDOWS_ENV, 'HOME', 'USERPROFILE',
    'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME',
    'XDG_CACHE_HOME', 'OPENCODE_TEST_HOME', 'OPENCODE_DB', 'OPENCODE_CONFIG',
    'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_PROJECT_DISABLE',
    'OPENCODE_DISABLE_MODELS_FETCH', 'OPENCODE_DISABLE_CLAUDE_CODE',
    'OPENCODE_DISABLE_CLAUDE_CODE_SKILLS', 'OPENCODE_DISABLE_AUTOUPDATE',
    'CTG_OPENCODE_HOME', 'TERM', 'COLORTERM', 'OPENCODE_PASSWORD',
    'OPENCODE_SERVER_PASSWORD', 'OPENCODE_SERVER_USERNAME'))
FIXTURE_ENV_KEYS = TUI_ENV_KEYS | frozenset((
    'CTG_OWNED_OPENCODE_RUNTIME', 'CTG_TEST_RUNTIME_RELEASE_MANIFEST'))


def filtered_parent_environment(source, home):
    """Build a child baseline from a short allowlist, never ambient credentials."""
    result = {key: source[key] for key in (*SAFE_PARENT_ENV, *SAFE_WINDOWS_ENV)
              if key in source}
    result['PATH'] = result.get('PATH', '/usr/bin:/bin')
    result['LANG'] = result.get('LANG', 'C.UTF-8')
    result['HOME'] = str(home)
    result['USERPROFILE'] = str(home)
    return result


def fixture_environment(source, home, owned_root, release_manifest):
    """Environment for fixture/preflight Node children; selectors are paths, not secrets."""
    result = filtered_parent_environment(source, home)
    result.update({
        'CTG_OWNED_OPENCODE_RUNTIME': str(owned_root),
        'CTG_TEST_RUNTIME_RELEASE_MANIFEST': str(release_manifest),
        'XDG_CONFIG_HOME': str(Path(home) / 'config'),
        'XDG_DATA_HOME': str(Path(home) / 'data'),
        'XDG_STATE_HOME': str(Path(home) / 'state'),
        'XDG_CACHE_HOME': str(Path(home) / 'cache'),
    })
    return result


def assert_clean_child_environment(env, allowed=TUI_ENV_KEYS):
    if any(key.casefold() == 'ctg_runtime_github_token' for key in env):
        raise AssertionError('child environment contains reserved runtime download credential')
    unexpected = sorted(set(env) - allowed)
    if unexpected:
        raise AssertionError(f'child environment contains non-allowlisted names: {unexpected}')
