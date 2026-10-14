import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerSubscriptionProviders } from '../lib/providers/subscription-models.mjs';

/** Overlay Claude/ChatGPT subscription model discovery on the builtin providers. */
export default function subscriptions(pi: ExtensionAPI) {
  registerSubscriptionProviders(pi as unknown as Parameters<typeof registerSubscriptionProviders>[0]);
}
