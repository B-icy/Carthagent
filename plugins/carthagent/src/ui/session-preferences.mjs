/** Persist the host-owned per-session opt-out without disturbing neighbor metadata. */
export async function setSessionAutoCompaction(client, sessionID, location, action) {
  if (action !== "toggle" && action !== "on" && action !== "off") throw new TypeError("Usage: /autocompact [on|off].");
  const options = { location, signal: AbortSignal.timeout(15_000) };
  const session = await client.get({ sessionID }, options);
  const metadata = { ...session.metadata };
  const enabled = metadata["ctg.autoCompaction"] !== false;
  const next = action === "on" ? true : action === "off" ? false : !enabled;
  if (next === enabled) return enabled;
  if (next) delete metadata["ctg.autoCompaction"];
  else metadata["ctg.autoCompaction"] = false;
  await client.update({ sessionID, metadata }, { location, signal: AbortSignal.timeout(15_000) });
  return next;
}
