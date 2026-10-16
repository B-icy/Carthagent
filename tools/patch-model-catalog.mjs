// Reapply after refreshing the vendored engine; fail closed on changed anchors.
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../vendor/agent/chunks/chunk-JVUZSMYM.js', import.meta.url);
let source = readFileSync(file, 'utf8');
const marker = '/* Carthagent owns model discovery; no pi.dev catalog. */';
if (!source.includes(marker)) {
  const anchor = 'function withRemoteCatalog(provider,catalogBaseUrl=DEFAULT_CATALOG_BASE_URL,localGeneratedAt){';
  if (source.split(anchor).length !== 2) throw new Error('Vendored model catalog anchor changed');
  source = source.replace(anchor, `${anchor}${marker}return provider;`);
  writeFileSync(file, source);
}
