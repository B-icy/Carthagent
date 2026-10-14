import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import {
  SUBSCRIPTION_PROVIDER_IDS,
  registerSubscriptionProviders,
} from '../lib/providers/subscription-models.mjs';

/**
 * Overlay Claude/ChatGPT subscription model discovery on the builtin
 * providers. Engine startup only runs offline refreshes, so a session-start
 * hook issues a bounded network refresh scoped to the two providers —
 * leaving it out lets new models appear for already-signed-in users.
 */
export default function subscriptions(pi: ExtensionAPI) {
  registerSubscriptionProviders(pi as unknown as Parameters<typeof registerSubscriptionProviders>[0], {
    agentDir: getAgentDir(),
  });
  pi.on('session_start', (_event: unknown, ctx: { modelRegistry?: { refresh?: (options: { providers: string[] }) => Promise<unknown> } }) => {
    void Promise.resolve(ctx?.modelRegistry?.refresh?.({ providers: [...SUBSCRIPTION_PROVIDER_IDS] })).catch(() => {});
  });
}
