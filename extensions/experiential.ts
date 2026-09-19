import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { experientialProviderConfig, EXPERIENTIAL_PROVIDER_ID } from '../lib/providers/experiential.mjs';

/** Register Experiential Labs for the bundled agent in TUI, RPC, and headless modes. */
export default function experiential(pi: ExtensionAPI) {
  pi.registerProvider(EXPERIENTIAL_PROVIDER_ID, experientialProviderConfig());
}
