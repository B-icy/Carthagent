#!/usr/bin/env node
/** Native-default Carthagent CLI launcher. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const argv = process.argv.slice(2);

// Keep metadata-only invocations independent of OpenCode startup, providers,
// and profile state. All operational commands use the native CLI route.
if (['help', '--help', '-h'].includes(argv[0])) {
  const { cliHelp } = await import('../lib/opencode/cli.mjs');
  console.log(cliHelp(version));
} else if (['--version', '-v'].includes(argv[0])) {
  console.log(version);
} else {
  try {
    const [{ createOpenCodeCliRuntime }, { runOpenCodeCli }] = await Promise.all([
      import('../lib/opencode/cli-runtime.mjs'),
      import('../lib/opencode/cli.mjs'),
    ]);
    const runtime = await createOpenCodeCliRuntime();
    process.exitCode = await runOpenCodeCli({
      argv,
      runtime,
      version,
      stdoutIsTTY: Boolean(process.stdout.isTTY),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1;
  }
}
