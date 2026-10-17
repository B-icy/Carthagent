import { createJiti } from 'jiti';

// Keep the native UI manifest and theme-preservation suite in the root test
// glob so `npm test` and the release quality gate actually execute it.
const jiti = createJiti(import.meta.url);
await jiti.import('../plugins/carthagent/tests/commands.test.ts');
