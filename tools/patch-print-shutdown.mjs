// Reapply after refreshing the vendored engine. Fail closed if upstream changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const path = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2]))
  : new URL('../vendor/agent/chunks/chunk-JVUZSMYM.js', import.meta.url);
let source = readFileSync(path, 'utf8');
const marker = 'undici.getGlobalDispatcher()===dispatcher&&await dispatcher.destroy(),await flushRawStdout()';

if (source.includes(marker)) {
  // Already patched; accept only the exact expected declaration/finalizer pair.
  const declaration = 'signalCleanupHandlers=[],dispatcher=undici.getGlobalDispatcher(),disposeRuntime=async()=>';
  if (source.split(marker).length !== 2 || source.split(declaration).length !== 2) {
    throw new Error('Found print shutdown marker without its dispatcher ownership guard');
  }
} else {
  const declaration = 'signalCleanupHandlers=[],disposeRuntime=async()=>';
  const replacement = 'signalCleanupHandlers=[],dispatcher=undici.getGlobalDispatcher(),disposeRuntime=async()=>';
  if (source.split(declaration).length !== 2) {
    throw new Error('Expected exactly one print-mode runtime declaration anchor');
  }
  source = source.replace(declaration, replacement);

  const finalizers = [
    'await disposeRuntime(),await globalThis[Symbol.for("carthagent.httpDispatcher.close")]?.(),await flushRawStdout()',
    'await disposeRuntime(),undici.getGlobalDispatcher()===dispatcher&&await dispatcher.destroy(),await flushRawStdout()',
  ];
  const finalizer = finalizers.find(anchor => source.split(anchor).length === 2);
  const patchedFinalizer = 'await disposeRuntime(),undici.getGlobalDispatcher()===dispatcher&&await dispatcher.destroy(),await flushRawStdout()';
  if (!finalizer) {
    throw new Error('Expected exactly one print-mode finalizer anchor');
  }
  source = source.replace(finalizer, patchedFinalizer);
}

writeFileSync(path, source);
