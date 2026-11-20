#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { installCrashHandlers } from '../lib/crash-report.mjs';
import { commandHelp, openCodeCliManifest, runOpenCodeCli } from '../lib/opencode/cli.mjs';
import { createOpenCodeCliRuntime } from '../lib/opencode/cli-runtime.mjs';

const argv = process.argv.slice(2);
if (argv[0] === 'native') argv.shift();
process.env.CTG_NODE_EXECUTABLE ??= process.execPath;
installCrashHandlers({ argv, cli: { isCommand: name => Boolean(commandHelp(name)), aliases: openCodeCliManifest.aliases } });

try {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  if (argv[0] === 'doctor' && argv.includes('--crash-report')) {
    const { printLatestCrashReport } = await import('../lib/opencode/doctor.mjs');
    process.exitCode = printLatestCrashReport();
  } else {
    const runtime = await createOpenCodeCliRuntime();
    const code = await runOpenCodeCli({ argv, runtime, version, stdoutIsTTY: Boolean(process.stdout.isTTY) });
    process.exitCode = Number.isInteger(code) ? code : 0;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1;
}
