import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

// Diagnostic-only instrumentation: preserve the shipped five-second deadline.
const file = 'lib/opencode/runtime.mjs';
const source = readFileSync(file, 'utf8');
const anchor = "    const child = spawnImpl(command, args, { cwd: options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });";
if (!source.includes(anchor)) throw new Error('Missing runCapture spawn anchor');
writeFileSync(file, source.replace(anchor, `
    const start = performance.now();
    ${anchor.trim()}
    console.error('VERSION_TRACE', JSON.stringify({event:'spawn',pid:child.pid,args,at:Date.now()}));
    child.stdout.on('data', chunk => console.error('VERSION_TRACE', JSON.stringify({event:'stdout',pid:child.pid,ms:performance.now()-start,bytes:chunk.length})));
    child.stderr.on('data', chunk => console.error('VERSION_TRACE', JSON.stringify({event:'stderr',pid:child.pid,ms:performance.now()-start,bytes:chunk.length})));
    child.on('exit', (code, signal) => console.error('VERSION_TRACE', JSON.stringify({event:'exit',pid:child.pid,ms:performance.now()-start,code,signal})));
    child.on('close', (code, signal) => console.error('VERSION_TRACE', JSON.stringify({event:'close',pid:child.pid,ms:performance.now()-start,code,signal})));
`));
const run = args => new Promise(resolve => {
  const child = spawn(process.execPath, args, {stdio:'inherit'});
  child.on('exit', code => resolve(code));
});
let failures = 0;
try {
  for (let n=0; n<5; n++) {
    console.log('STARTUP_SEQUENCE', n+1);
    for (const script of ['tools/test-native-host.mjs','tools/test-native-ship-models.mjs','tools/test-native-daily-quests.mjs']) {
      const code = await run([script]);
      console.log('STARTUP_RESULT', JSON.stringify({sequence:n+1,script,code}));
      if(code !== 0) failures++;
    }
  }
} finally { writeFileSync(file,source); }
console.log('STARTUP_SUMMARY',JSON.stringify({failures}));
process.exitCode = failures ? 1 : 0;
