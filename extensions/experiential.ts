import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { experientialProviderConfig, EXPERIENTIAL_PROVIDER_ID } from '../lib/providers/experiential.mjs';
import { cloudManagedUsageRecovery } from '../lib/cloud/client.mjs';

/** Register Carthagent Ship for the bundled agent in TUI, RPC, and headless modes. */
export default function experiential(pi: ExtensionAPI) {
  pi.registerProvider(EXPERIENTIAL_PROVIDER_ID, experientialProviderConfig());
  pi.on('message_end', (event: any, ctx: any) => {
    const message = event?.message;
    if (message?.role !== 'assistant' || message.stopReason !== 'error') return;
    if (message.provider !== EXPERIENTIAL_PROVIDER_ID && ctx?.model?.provider !== EXPERIENTIAL_PROVIDER_ID) return;
    const recovery = cloudManagedUsageRecovery(message.errorMessage);
    if (!recovery) return;
    ctx.ui?.notify?.(recovery, 'warning');
  });
}
