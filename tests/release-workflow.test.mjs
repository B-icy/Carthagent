import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

test('release workflow requires owned runtime during installed package acceptance', () => {
  const acceptance = workflow.match(/- name: Accept the installed package with its owned runtime required([\s\S]*?)(?=\n      - |\n\n  publish)/)?.[1];
  assert.ok(acceptance, 'installed acceptance step exists');
  assert.match(acceptance, /CTG_REQUIRE_OWNED_RUNTIME:\s*['"]?1/);
  assert.match(acceptance, /npm run test:native-package/);
  assert.match(acceptance, /CTG_RUNTIME_GITHUB_TOKEN:\s*['"]{2}/);
});

test('published release runtime verification explicitly uses the anonymous asset path', () => {
  const verify = workflow.match(/- name: Verify runtime archives against the packaged immutable manifest([\s\S]*?)(?=\n      - |\n\s+run:)/)?.[1];
  assert.ok(verify);
  assert.match(verify, /CTG_RUNTIME_GITHUB_TOKEN:\s*['"]{2}/);
});

test('npm publication is guarded by release verification and selects latest or next', () => {
  const publish = workflow.match(/  publish-npm:\n([\s\S]*?)(?=\n  publish-release-manifest:)/)?.[1];
  assert.ok(publish, 'npm publication job exists');
  assert.match(publish, /needs: verify-release/);
  assert.match(publish, /id-token:\s*write/);
  assert.match(publish, /node-version: 24/);
  assert.match(publish, /registry-url: https:\/\/registry\.npmjs\.org/);
  assert.match(publish, /refs\/tags\/\$\{RELEASE_TAG\}/);
  assert.match(publish, /\[ "\$tag_sha" != "\$EXPECTED_SHA" \]/);
  assert.match(publish, /Set the NPM_TOKEN repository secret/);
  assert.match(publish, /npm view "carthagent@\$\{version\}" version --json/);
  assert.match(publish, /dist_tag=latest/);
  assert.match(publish, /dist_tag=next/);
  assert.match(publish, /npm publish --provenance --access public --tag "\$dist_tag"/);
});

test('the final publish step resolves the remote lightweight or annotated tag immediately before POST', () => {
  const publish = workflow.match(/- name: Publish the CLI release manifest to the control plane([\s\S]*)/)?.[1];
  assert.ok(publish, 'publish step exists');
  assert.match(publish, /gh api [^\n]*git\/ref\/tags\/\$\{RELEASE_TAG\}/);
  assert.match(publish, /while \[ "\$tag_type" = tag \]/);
  assert.match(publish, /\[ "\$tag_object" != "\$EXPECTED_SHA" \]/);
  const verifyIndex = publish.indexOf('if [ "$tag_object" != "$EXPECTED_SHA" ]');
  const postIndex = publish.indexOf('curl -fsS -X POST');
  assert.ok(verifyIndex >= 0 && postIndex > verifyIndex, 'tag equality check precedes POST in the same step');
});
