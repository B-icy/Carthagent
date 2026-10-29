import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Never emit free-form log text: even an otherwise harmless line can contain
// credentials, headers, or a partial secret at the bounded buffer's edge.
export function sanitizedNativeOutputTail(output) {
  return String(output).slice(-16384).split(/\r?\n/).slice(-20).map(line => ({
    level: line.match(/\b(INFO|WARN|ERROR|DEBUG|TRACE)\b/)?.[1] ?? 'unknown',
    markers: ['shutdown', 'stopping', 'stopped', 'closed', 'exit', 'signal', 'timeout', 'error', 'dispose', 'disposing']
      .filter(marker => new RegExp(`\\b${marker}\\b`, 'i').test(line)),
  }));
}

export async function fixtureStopDiagnostics({ child, output, elapsedMs }, { run = promisify(execFile), platform = process.platform } = {}) {
  // Snapshot before the read-only OS query; the child may exit during it.
  const evidence = {
    elapsedMs: Math.round(elapsedMs),
    child: { pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode, killed: child.killed },
    outputTail: sanitizedNativeOutputTail(output),
  };
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
    evidence.processState = { status: 'no-child-pid' };
    return evidence;
  }
  const windows = platform === 'win32';
  const command = windows ? 'powershell.exe' : 'ps';
  const args = windows
    ? ['-NoProfile', '-NonInteractive', '-Command', `$p = Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue; if ($null -ne $p) { Write-Output ("pid={0} responding={1}" -f $p.Id, $p.Responding) }`]
    : ['-p', String(child.pid), '-o', 'pid=,ppid=,stat=,etime=,time='];
  try {
    const { stdout } = await run(command, args, { timeout: 2000, maxBuffer: 4096, windowsHide: true });
    const state = stdout.trim();
    // Only numeric process metadata and fixed state codes; never argv, names,
    // environment, stderr, database contents, or OS command error messages.
    const valid = windows
      ? new RegExp(`^pid=${child.pid} responding=(True|False)$`).test(state)
      : new RegExp(`^${child.pid}\\s+\\d+\\s+[A-Za-z<+Ns]+\\s+[\\d:.-]+\\s+[\\d:.]+$`).test(state);
    evidence.processState = { status: !state ? 'not-found' : valid ? 'observed' : 'unrecognized-output', ...(valid ? { state } : {}) };
  } catch (error) {
    evidence.processState = { status: 'query-failed', exitCode: Number.isInteger(error.code) ? error.code : null, timedOut: error.killed === true };
  }
  return evidence;
}
