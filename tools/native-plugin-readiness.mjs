/** Wait for plugin initialization, preserving the host inventory as evidence. */
export async function waitForPluginActive(pluginID, {
  listPlugins,
  timeoutMs = 15_000,
  hostOutput = () => '',
  pollIntervalMs = 100,
}) {
  const deadline = Date.now() + timeoutMs;
  let inventory;
  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`Timed out waiting for plugin ${pluginID} to become active; observed ${JSON.stringify(inventory?.data ?? [])}\nHost output:\n${hostOutput()}`);
    }
    try {
      inventory = await listPlugins(remainingMs);
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for plugin ${pluginID} to become active; last observed inventory ${JSON.stringify(inventory?.data ?? [])}; inventory request failed: ${error.message}\nHost output:\n${hostOutput()}`, { cause: error });
      }
      throw error;
    }
    const plugin = inventory.data.find((entry) => entry.id === pluginID);
    if (plugin?.state?.status === 'active') return plugin;
    if (plugin?.state?.status === 'error') {
      throw new Error(`Plugin ${pluginID} failed to initialize: ${JSON.stringify(plugin)}\nHost output:\n${hostOutput()}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for plugin ${pluginID} to become active; observed ${JSON.stringify(inventory.data)}\nHost output:\n${hostOutput()}`);
    }
    await new Promise((done) => setTimeout(done, Math.min(pollIntervalMs, Math.max(0, deadline - Date.now()))));
  }
}
