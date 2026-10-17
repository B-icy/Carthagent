#!/usr/bin/env node
/** Prepare two rendered native sessions in an isolated pinned-host database. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeFixture, streamText } from './native-fixture.mjs';

const plugin = process.argv[2];
if (!plugin) throw new Error('Usage: seed-native-switch-fixture.mjs /absolute/path/to/snapshot/plugins/carthagent');
const keepServer = process.argv.includes('--serve');
const noPlugin = process.argv.includes('--no-plugin');
const readyFile = process.argv.find(value => value.startsWith('--ready-file='))?.slice('--ready-file='.length);
const manifestPath = process.env.CTG_PERF_MANIFEST;
if (!manifestPath) throw new Error('CTG_PERF_MANIFEST must identify the paired-run provenance manifest');
const provenance = JSON.parse(await readFile(manifestPath, 'utf8'));
const host = await nativeFixture({
  plugin: noPlugin ? null : plugin,
  verifyInventory: true,
  pluginExpected: noPlugin ? 'absent' : 'active',
  provenance,
  preserveTemp: true,
  respond(body, response) {
    const serialized = JSON.stringify(body);
    const marker = serialized.includes('UNIQUE_RENDERED_DESTINATION_BRAVO_7C91')
      ? 'UNIQUE_RENDERED_DESTINATION_BRAVO_7C91'
      : 'UNIQUE_RENDERED_DESTINATION_ALPHA_7C91';
    streamText(response, marker);
  },
});
let fixtureReady = false;
try {
  // Keep both sessions in one selected project; Open Sessions exposes native
  // session rows within the active project workspace.
  const roots = { alpha: join(host.temp, 'project-alpha'), bravo: join(host.temp, 'project-alpha') };
  await Promise.all(Object.values(roots).map(path => mkdir(path, { recursive: true })));
  const fixtures = {};
  for (const [name, title, marker] of [
    ['alpha', 'PERF SESSION ALPHA', 'UNIQUE_RENDERED_DESTINATION_ALPHA_7C91'],
    ['bravo', 'PERF SESSION BRAVO', 'UNIQUE_RENDERED_DESTINATION_BRAVO_7C91'],
  ]) {
    const location = { directory: roots[name] };
    const session = await host.client.session.create({ location, model: host.model, title }, host.request());
    await host.client.session.prompt({ sessionID: session.id, text: `Reply with exactly this fixture marker and nothing else: ${marker}` }, host.request());
    await host.client.session.wait({ sessionID: session.id }, host.request());
    const messages = await host.client.session.context({ sessionID: session.id }, host.request());
    if (!messages.some(message => message.type === 'assistant' &&
        message.content?.some(part => part.type === 'text' && part.text.includes(marker)))) {
      throw new Error(`Session ${name} did not persist unique assistant marker ${marker}`);
    }
    fixtures[name] = { id: session.id, title, marker, directory: roots[name] };
  }
  const readinessSession = await host.client.session.create({
    location: { directory: roots.alpha }, model: host.model, title: 'PERF READINESS EMPTY SESSION',
  }, host.request());
  const fixture = { temp: host.temp, roots, sessions: fixtures,
    readinessSession: { id: readinessSession.id, directory: roots.alpha },
    runtimeIdentity: host.runtimeIdentity,
    serverPid: host.serverPid(),
    pluginObservation: host.pluginObservation, pluginInventory: host.pluginInventory,
    pluginHealth: host.pluginHealth, provenance };
  fixture.baseUrl = host.baseUrl;
  fixture.password = host.password;
  const agentDir = join(host.temp, 'home/.carthagent/agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'keybindings.json'), JSON.stringify({ 'open.menu': 'ctrl+o' }));
  const path = join(host.temp, 'native-switch-fixture.json');
  await writeFile(path, JSON.stringify(fixture, null, 2));
  // The fixture file contains the local server password; keep it out of retained logs.
  console.log(JSON.stringify({ path }));
  if (readyFile) await writeFile(readyFile, path);
  fixtureReady = true;
  if (keepServer) {
    await new Promise(resolve => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  }
} finally {
  await host.close({ preserveTemp: fixtureReady });
}
