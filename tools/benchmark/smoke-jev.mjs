// Retained entry point; the old standalone smoke bypassed campaign accounting.
// All new live checks now use the exclusive, centrally accounted preflight.
import { livePreflight } from './preflight-live.mjs';
if (process.argv[2] !== '--paid') throw Error('Use node tools/benchmark/preflight-live.mjs --paid (shared smoke budget, no overwrite/retry).');
console.log(JSON.stringify(await livePreflight()));
