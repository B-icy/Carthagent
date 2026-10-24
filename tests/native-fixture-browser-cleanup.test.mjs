import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { stopFixtureBrowser } from '../tools/native-fixture-browser-cleanup.mjs';

test('fixture browser cleanup keeps narrow authority and bounded verification', () => {
  assert.match(stopFixtureBrowser, /Same-Identity/);
  assert.match(stopFixtureBrowser, /CreationDate -eq/);
  assert.match(stopFixtureBrowser, /Contains\(\$env:CTG_NATIVE_FIXTURE_URL\)/);
  assert.match(stopFixtureBrowser, /taskkill.exe \/PID \$root.ProcessId \/T \/F/);
  assert.match(stopFixtureBrowser, /AddSeconds\(5\)/);
  assert.doesNotMatch(stopFixtureBrowser, /catch\s*\{/);
});

// Execute the production PowerShell with synthetic CIM snapshots and a mocked
// taskkill command. No browser is launched and no real process can be killed.
async function scenario(mode) {
  const harness = `
    $env:CTG_NATIVE_FIXTURE_URL = 'http://127.0.0.1:1234/verify-test'
    $script:reads = 0
    $script:kills = 0
    $root = [pscustomobject]@{ ProcessId = 10; ParentProcessId = 1; CreationDate = [datetime]'2026-01-01'; Name = 'msedge.exe'; CommandLine = $env:CTG_NATIVE_FIXTURE_URL }
    $child = [pscustomobject]@{ ProcessId = 11; ParentProcessId = 10; CreationDate = [datetime]'2026-01-02'; Name = 'msedge.exe'; CommandLine = '--child' }
    $grandchild = [pscustomobject]@{ ProcessId = 12; ParentProcessId = 11; CreationDate = [datetime]'2026-01-03'; Name = 'msedge.exe'; CommandLine = '--grandchild' }
    function Get-CimInstance {
      $script:reads++
      if ($script:reads -eq 1) { return @($grandchild, $child, $root) }
      if ('${mode}' -eq 'already-exited') { return @() }
      if ('${mode}' -eq 'pid-reused') {
        return [pscustomobject]@{ ProcessId = 10; ParentProcessId = 1; CreationDate = [datetime]'2026-02-01'; Name = 'msedge.exe'; CommandLine = $env:CTG_NATIVE_FIXTURE_URL }
      }
      if ($script:reads -eq 2) { return @($root, $child, $grandchild) }
      if ('${mode}' -eq 'live-child') { return @($grandchild) }
      return @()
    }
    function taskkill.exe {
      if (($args -join ' ') -ne '/PID 10 /T /F') { throw 'Unexpected kill target' }
      $script:kills++
      $global:LASTEXITCODE = 1
      'simulated unsupported child termination'
    }
    ${stopFixtureBrowser}
    Write-Output "kills=$script:kills"
  `;
  return promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', harness], { timeout: 20_000, windowsHide: true });
}

const windows = { skip: process.platform !== 'win32' };
test('partial taskkill error succeeds only after all captured identities disappear', windows, async () => {
  assert.match((await scenario('all-gone')).stdout, /kills=1/);
});
test('partial taskkill error fails with diagnostics for a surviving transitive child', windows, async () => {
  await assert.rejects(scenario('live-child'), error => {
    assert.match(error.stderr, /identities still alive: 12/);
    assert.match(error.stderr, /taskkill exit 1/);
    assert.match(error.stderr, /simulated unsupported child termination/);
    return true;
  });
});
for (const mode of ['already-exited', 'pid-reused']) {
  test(`${mode} snapshot root is never targeted`, windows, async () => {
    assert.match((await scenario(mode)).stdout, /kills=0/);
  });
}
