// Only the randomized fixture URL grants authority to stop a browser tree.
export const stopFixtureBrowser = String.raw`
  $ErrorActionPreference = 'Stop'
  if ([string]::IsNullOrEmpty($env:CTG_NATIVE_FIXTURE_URL)) { throw 'Missing fixture browser URL' }
  function Same-Identity($a, $b) {
    return $a.ProcessId -eq $b.ProcessId -and $null -ne $a.CreationDate -and $a.CreationDate -eq $b.CreationDate
  }
  function Is-FixtureRoot($p) {
    return $p.Name -ieq 'msedge.exe' -and $p.CommandLine -and $p.CommandLine.Contains($env:CTG_NATIVE_FIXTURE_URL)
  }
  $snapshot = @(Get-CimInstance Win32_Process)
  $roots = @($snapshot | Where-Object { Is-FixtureRoot $_ })
  $captured = @{}
  foreach ($root in $roots) {
    if ($null -eq $root.CreationDate) { throw "Missing creation identity for fixture browser PID $($root.ProcessId)" }
    $captured[$root.ProcessId] = $root
  }
  # Capture every transitive descendant, including those without the URL.
  do {
    $added = $false
    foreach ($p in $snapshot) {
      if (!$captured.ContainsKey($p.ProcessId) -and $captured.ContainsKey($p.ParentProcessId)) {
        $parent = $captured[$p.ParentProcessId]
        if ($null -eq $p.CreationDate) { throw "Missing creation identity for descendant PID $($p.ProcessId)" }
        # An older process cannot be a child of this incarnation of its parent PID.
        if ($p.CreationDate -ge $parent.CreationDate) {
          $captured[$p.ProcessId] = $p
          $added = $true
        }
      }
    }
  } while ($added)
  $diagnostics = @()
  foreach ($root in $roots) {
    $current = @(Get-CimInstance Win32_Process | Where-Object { Same-Identity $_ $root })
    if ($current.Count -eq 0) { continue }
    if (!(Is-FixtureRoot $current[0])) { throw "Fixture browser URL changed for PID $($root.ProcessId)" }
    # Capture native stderr as diagnostics, not a PowerShell terminating error.
    $savedPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = @(& taskkill.exe /PID $root.ProcessId /T /F 2>&1)
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $savedPreference
    $diagnostics += "PID $($root.ProcessId), taskkill exit $exitCode : $($output -join '; ')"
  }
  # Exit status alone is insufficient: taskkill can report a child error after
  # stopping the root. Conversely, root disappearance does not prove child exit.
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  do {
    $alive = @(Get-CimInstance Win32_Process | Where-Object {
      $captured.ContainsKey($_.ProcessId) -and (Same-Identity $_ $captured[$_.ProcessId])
    })
    if ($alive.Count -eq 0) { break }
    if ([DateTime]::UtcNow -ge $deadline) {
      throw "Fixture browser identities still alive: $($alive.ProcessId -join ', '); $($diagnostics -join ' | ')"
    }
    Start-Sleep -Milliseconds 100
  } while ($true)
`;
