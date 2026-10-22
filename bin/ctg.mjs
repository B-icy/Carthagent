#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { runOpenCodeCli } from '../lib/opencode/cli.mjs';
import { createOpenCodeCliRuntime } from '../lib/opencode/cli-runtime.mjs';

const argv = process.argv.slice(2);
if (argv[0] === 'native') argv.shift();
process.env.CTG_NODE_EXECUTABLE ??= process.execPath;

try {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const runtime = await createOpenCodeCliRuntime();
  const code = await runOpenCodeCli({ argv, runtime, version, stdoutIsTTY: Boolean(process.stdout.isTTY) });
  process.exitCode = Number.isInteger(code) ? code : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 1;
}
