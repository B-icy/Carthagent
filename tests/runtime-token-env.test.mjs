import assert from 'node:assert/strict';
import test from 'node:test';
import { withoutRuntimeGithubToken } from '../tools/runtime-token-env.mjs';

test('npm child environment removes runtime download token case-insensitively and preserves PATH', () => {
  const original = {
    PATH: '/fixture/path',
    Path: '/fixture/windows-path',
    LANG: 'C.UTF-8',
    CTG_RUNTIME_GITHUB_TOKEN: 'fake-uppercase-token',
    ctg_runtime_github_token: 'fake-lowercase-token',
    Ctg_Runtime_Github_Token: 'fake-mixedcase-token',
    CTG_RUNTIME_OTHER: 'unrelated-runtime-value',
  };
  const result = withoutRuntimeGithubToken(original);
  assert.deepEqual(result, {
    PATH: '/fixture/path',
    Path: '/fixture/windows-path',
    LANG: 'C.UTF-8',
    CTG_RUNTIME_OTHER: 'unrelated-runtime-value',
  });
  assert.equal(original.ctg_runtime_github_token, 'fake-lowercase-token', 'sanitizer must not mutate the caller environment');
});
