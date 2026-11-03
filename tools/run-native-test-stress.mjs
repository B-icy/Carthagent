import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Native renderer state and Bun's module cache survive --rerun-each. Start a
// fresh process for every full-suite repetition, while retaining all assertions.
// The parent is Node so a blocked Bun/native event loop cannot block the deadline.
export function runNativeTestStress({ repetitions, timeoutMs, command, args, cwd = process.cwd(), log = console.log }) {
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !command) {
    throw new TypeError('Expected positive repetitions, timeout milliseconds, and a command');
  }
  for (let iteration = 1; iteration <= repetitions; iteration++) {
    log(`Native test repetition ${iteration}/${repetitions}: ${command} ${args.join(' ')}`);
    const result = spawnSync(command, args, { cwd, stdio: 'inherit', timeout: timeoutMs, killSignal: 'SIGKILL' });
    if (result.error || result.signal || result.status !== 0) {
      const reason = result.error?.code === 'ETIMEDOUT'
        ? `exceeded external ${timeoutMs} ms deadline`
        : result.error?.message ?? `exited with ${result.signal ?? result.status}`;
      throw new Error(`Native test repetition ${iteration}/${repetitions} ${reason}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [repetitions, timeoutMs, command, ...args] = process.argv.slice(2);
  try {
    runNativeTestStress({ repetitions: Number(repetitions), timeoutMs: Number(timeoutMs), command, args });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
