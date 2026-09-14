/** Worker thread: compute the workspace fingerprint off the UI thread. */
import { parentPort } from 'node:worker_threads';
import { fingerprint } from '../delivery.mjs';

parentPort.on('message', ({ cwd, roots }) => {
  try {
    parentPort.postMessage({ hash: fingerprint(cwd, roots) });
  } catch (err) {
    parentPort.postMessage({ error: String(err.message || err) });
  }
});
