import assert from 'node:assert/strict';

export function sections(patch) {
  const result = new Map();
  for (const section of patch.split(/(?=^diff --git )/m).filter(Boolean)) {
    const path = section.match(/^diff --git a\/(\S+) b\/\1\n/)?.[1];
    assert.ok(path?.startsWith('packages/'), 'every section must name an upstream package file');
    assert.ok(!path.split('/').includes('..'), `unsafe path: ${path}`);
    assert.ok(!result.has(path), `duplicate diff section: ${path}`);
    result.set(path, section.replace(/^index .*\n/gm, ''));
  }
  assert.ok(result.size > 0, 'complete candidate patch must not be empty');
  return result;
}
