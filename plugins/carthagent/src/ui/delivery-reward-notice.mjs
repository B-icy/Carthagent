/**
 * Tells the user when a finished turn produced a verified delivery that can be
 * claimed for a Voyages reward. Claiming stays an explicit, confirmed action
 * (/voyages claim); this only makes it discoverable. One notice per delivery run.
 */
export const DELIVERY_REWARD_NOTICE = "Verified delivery. Claim +25 coins, +100 XP and +1 km with /voyages claim (up to 3 per UTC day).";

export function createDeliveryRewardNotice({ delivery, notify, signal } = {}) {
  const seen = new Set();
  const pending = new Map();
  async function check(sessionID) {
    if (!sessionID || signal?.aborted) return false;
    const result = await delivery(sessionID, signal);
    if (result?.status !== "verified" || typeof result.runId !== "string" || !result.runId) return false;
    const key = `${sessionID}\0${result.runId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > 500) seen.delete(seen.values().next().value);
    notify(DELIVERY_REWARD_NOTICE, sessionID);
    return true;
  }
  return {
    onSucceeded(event) {
      const sessionID = event?.data?.sessionID;
      if (!sessionID) return Promise.resolve(false);
      // Coalesce bursts of succeeded events for one session into a single lookup.
      const running = pending.get(sessionID);
      if (running) return running;
      const current = check(sessionID).catch(() => false).finally(() => pending.delete(sessionID));
      pending.set(sessionID, current);
      return current;
    },
  };
}
