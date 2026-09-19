import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { experientialProviderConfig, EXPERIENTIAL_PROVIDER_ID } from '../lib/providers/experiential.mjs';

/** Register Carthagent Cloud for the bundled agent in TUI, RPC, and headless modes. */
export default function experiential(pi: ExtensionAPI) {
  pi.registerProvider(EXPERIENTIAL_PROVIDER_ID, experientialProviderConfig());
  pi.on('message_end', (event: any, ctx: any) => {
    const message = event?.message;
    if (message?.role !== 'assistant' || message.stopReason !== 'error') return;
    if (message.provider !== EXPERIENTIAL_PROVIDER_ID && ctx?.model?.provider !== EXPERIENTIAL_PROVIDER_ID) return;
    if (!/insufficient_quota|insufficient.credit|credit (?:is )?exhausted/i.test(String(message.errorMessage || ''))) return;
    ctx.ui?.notify?.('Carthagent Cloud credit is exhausted. Use /billing checkout to add Builder credit, or /login to connect a direct BYOK provider.', 'warning');
  });
}
