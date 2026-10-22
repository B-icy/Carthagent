"""Strict child-environment allowlists for the native slash acceptance probe."""
from pathlib import Path

SAFE_PARENT_ENV = ('PATH', 'LANG', 'LC_ALL')
SAFE_WINDOWS_ENV = ('SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT')
TUI_ENV_KEYS = frozenset((*SAFE_PARENT_ENV, *SAFE_WINDOWS_ENV, 'HOME', 'USERPROFILE',
    'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME',
    'XDG_CACHE_HOME', 'OPENCODE_CONFIG_PROJECT_DISABLE', 'OPENCODE_PASSWORD',
    'OPENCODE_SERVER_PASSWORD', 'OPENCODE_SERVER_USERNAME', 'TERM', 'COLORTERM'))
FIXTURE_ENV_KEYS = TUI_ENV_KEYS | frozenset((
    'CTG_OWNED_OPENCODE_RUNTIME', 'CTG_TEST_RUNTIME_RELEASE_MANIFEST'))


def fixture_environment(source, home, owned_root, release_manifest):
    result = {key: source[key] for key in (*SAFE_PARENT_ENV, *SAFE_WINDOWS_ENV)
              if key in source}
    result['PATH'] = result.get('PATH', '/usr/bin:/bin')
    result['LANG'] = result.get('LANG', 'C.UTF-8')
    result.update({
        'HOME': str(home), 'USERPROFILE': str(home),
        'CTG_OWNED_OPENCODE_RUNTIME': str(owned_root),
        'CTG_TEST_RUNTIME_RELEASE_MANIFEST': str(release_manifest),
        'XDG_CONFIG_HOME': str(Path(home) / 'config'),
        'XDG_DATA_HOME': str(Path(home) / 'data'),
        'XDG_STATE_HOME': str(Path(home) / 'state'),
        'XDG_CACHE_HOME': str(Path(home) / 'cache'),
    })
    return result


def assert_clean_child_environment(env, allowed=TUI_ENV_KEYS):
    forbidden = {'ctg_runtime_github_token', 'anthropic_api_key', 'openai_api_key',
                 'openrouter_api_key', 'opencode_api_key'}
    if any(key.casefold() in forbidden for key in env):
        raise AssertionError('child environment contains a provider/runtime credential')
    unexpected = sorted(set(env) - allowed)
    if unexpected:
        raise AssertionError(f'child environment contains non-allowlisted names: {unexpected}')
