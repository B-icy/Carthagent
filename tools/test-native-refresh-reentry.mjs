/** Real pinned host regression: expired OAuth must not resolve its own refresh.
 * Only disposable fixture credentials and loopback traffic are used. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { nativeFixture } from './native-fixture.mjs';
import { assertPluginCondition } from './native-paired-guards.mjs';

let rotations = 0;
let discoveries = 0;
let switchAccount;
const cloud = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (req.url === '/v1/token/refresh') {
    assert.equal(JSON.parse(raw).refreshToken, 'fixture-expired-refresh');
    rotations++;
    await switchAccount?.();
    // Keep rotation in flight while concurrent real host requests arrive.
    await new Promise(resolve => setTimeout(resolve, 150));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ accessToken: 'fixture-rotated-access', refreshToken: 'fixture-rotated-refresh', expiresIn: 3600 }));
    return;
  }
  if (req.url === '/v1/models' && ['Bearer fixture-rotated-access', 'Bearer fixture-account-b'].includes(req.headers.authorization)) {
    discoveries++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'refresh-reentry-fixture' }] }));
    return;
  }
  res.writeHead(404); res.end('{}');
});
let fixture;
try {
  cloud.listen(0, '127.0.0.1');
  await once(cloud, 'listening');
  // Installed-product fixture, like test-native-controls: source-snapshot
  // verification requires the checkout lockfile and is not a package contract.
  // Verify the real installed inventory and health explicitly at each start.
  fixture = await nativeFixture({ plugin: process.argv[2],
    env: { CARTHAGENT_CLOUD_URL: `http://127.0.0.1:${cloud.address().port}`,
      EXP_GATEWAY_URL: `http://127.0.0.1:${cloud.address().port}/v1` } });
  // Keep the independent activation location used by the source fixture,
  // without its checkout-only provenance checks.
  const activationLocation = { directory: join(fixture.temp, 'project-alpha') };
  await fixture.client.session.create({ location: activationLocation, model: fixture.model,
    title: 'native plugin activation probe' }, fixture.request());
  await fixture.active(activationLocation);
  await fixture.active();
  const location = fixture.location;
  const verifyPlugin = async () => {
    const inventory = (await fixture.client.plugin.list({ location }, fixture.request())).data;
    assertPluginCondition(inventory, true);
    assert.equal(inventory.filter(plugin => plugin.id === 'carthagent').length, 1);
    assert.ok(!inventory.some(plugin => ['failed', 'error'].includes(plugin.state.status)));
    const health = (await fixture.client.rpc.call({ rpcID: 'carthagent', method: 'health', input: {}, location }, fixture.request())).output;
    assert.equal(health.hostVersion, fixture.runtimeIdentity.runtimeVersion);
    assert.equal(health.protocol, 1);
    assert.equal(health.directory, location.directory);
  };
  await verifyPlugin();
  const otherValue = { type: 'oauth', methodID: 'carthagent-device', access: 'fixture-account-b',
    refresh: 'fixture-refresh-b', expires: Date.now() + 3600000 };
  const other = await fixture.client.credential.create({ integrationID: 'experiential-labs',
    value: otherValue, activate: true }, fixture.request());
  switchAccount = () => fixture.client.credential.activate({ credentialID: other.id }, fixture.request());
  const created = await fixture.client.credential.create({ integrationID: 'experiential-labs',
    value: { type: 'oauth', methodID: 'carthagent-device', access: 'fixture-expired-access',
      refresh: 'fixture-expired-refresh', expires: 1 }, activate: true }, fixture.request());
  await Promise.all(Array.from({ length: 8 }, () => fixture.client.model.list({ location }, fixture.request(8000))));
  const deadline = Date.now() + 8000;
  while (true) {
    const stored = (await fixture.client.credential.list(fixture.request(8000))).find(entry => entry.id === created.id);
    const models = (await fixture.client.model.list({ location }, fixture.request(8000))).data;
    if (stored?.value.refresh === 'fixture-rotated-refresh' && models.some(model => model.id === 'refresh-reentry-fixture')) break;
    assert.ok(Date.now() < deadline, `Expired OAuth refresh must persist and publish models without resolve reentry (rotations=${rotations}, discoveries=${discoveries}, persisted=${stored?.value.refresh === 'fixture-rotated-refresh'})`);
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.equal(rotations, 1);
  assert.ok(discoveries > 0);
  const accounts = await fixture.client.credential.list(fixture.request());
  assert.deepEqual(accounts.find(entry => entry.id === other.id).value, otherValue, 'Switching to B must not copy B into A or mutate B');
  assert.equal(accounts.find(entry => entry.id === other.id).active, true);
  await fixture.stop();
  await fixture.start();
  await fixture.active();
  await verifyPlugin();
  const persisted = (await fixture.client.credential.list(fixture.request())).find(entry => entry.id === created.id);
  assert.equal(persisted.value.refresh, 'fixture-rotated-refresh');
  assert.equal(rotations, 1, 'restart must reuse the host-persisted rotation');
  console.log(JSON.stringify({ passed: true, runtime: fixture.runtimeIdentity.runtimeVersion,
    binarySha256: fixture.runtimeIdentity.binarySha256, rotations, discoveries,
    concurrentRequests: 8, persistedAcrossRestart: true, accountSwitchIsolated: true }));
} finally {
  await fixture?.close();
  cloud.closeAllConnections();
  await new Promise(resolve => cloud.close(resolve));
}
