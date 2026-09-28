import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeEnv } from './runtime.mjs';
// Credentials travel through stdin config, never argv or files. Request BODY uses
// a private 0700 directory / 0600 file: curl's inline config has a line-size limit.
// No Node TLS / connection reuse; body files are removed on close/spawn failure.
// Abrupt supervisor termination may leave private files; this is not zero retention.
export function createCurlTransport({ executable = '/usr/bin/curl', caFile, maxBytes = 4000000, timeoutMs = 180000, allowLoopbackHttp = false } = {}) {
  return async function curlFetch(url, options = {}) {
    const target = new URL(url);
    if (target.protocol !== 'https:' && !(allowLoopbackHttp && target.protocol === 'http:' && target.hostname === '127.0.0.1')) throw Error('HTTPS required');
    if (target.username || target.password) throw Error('URL credentials forbidden');
    options.signal?.throwIfAborted();
    const headers = Object.entries(options.headers || {}).map(([k,v]) => {
      if (!/^[A-Za-z0-9-]+$/.test(k) || /[\r\n\0]/.test(String(v))) throw Error('Invalid HTTP header');
      return `header = ${JSON.stringify(`${k}: ${v}`)}\n`;
    }).join('');
    const directory = mkdtempSync(join(tmpdir(), 'ctg-http-body-'));
    const bodyPath = join(directory, 'body');
    try { writeFileSync(bodyPath, options.body || '', { mode: 0o600 }); }
    catch (error) { rmSync(directory,{recursive:true,force:true}); throw error; }
    const args = ['-q', '--silent', '--show-error', '--http1.1', '--proto', allowLoopbackHttp ? '=http,https' : '=https', '--max-redirs', '0', '--connect-timeout', '15', '--max-time', String(timeoutMs / 1000), '--retry', '0', '--request', options.method || 'POST', '--config', '-', '--data-binary', '@' + bodyPath, '--include', '--write-out', '\n%{http_code}', ...(caFile ? ['--cacert', caFile] : []), '--url', target.href];
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { env: safeEnv(), stdio: ['pipe','pipe','pipe'] });
      let chunks = [], bytes = 0, failure;
      const fail = (code) => { failure ||= Object.assign(Error('HTTPS transport failed'), { code }); child.kill('SIGKILL'); };
      const abort = () => fail('ABORTED');
      const timer = setTimeout(() => fail('TRANSPORT_TIMEOUT'), timeoutMs + 1000);
      options.signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', b => { bytes += b.length; if (bytes > maxBytes + 65536 + 4) fail('RESPONSE_TOO_LARGE'); else chunks.push(b); });
      // Drain but do not expose curl stderr, which can include server-controlled content.
      child.stderr.on('data', () => {});
      child.on('error', () => { failure ||= Object.assign(Error('HTTPS transport unavailable'), { code: 'TRANSPORT_SPAWN' }); });
      child.stdin.on('error', () => {});
      child.on('close', code => {
        clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
        rmSync(directory,{recursive:true,force:true});
        if (failure || code !== 0) return reject(failure || Object.assign(Error('HTTPS transport failed'), { code: `CURL_${code}` }));
        const data = Buffer.concat(chunks), status = Number(data.subarray(-3).toString());
        if (data.at(-4) !== 10 || status < 200 || status > 599) return reject(Error('Invalid HTTPS status'));
        let body = data.subarray(0,-4), headerBytes = 0, fields;
        do {
          const end = body.indexOf('\r\n\r\n');
          if (end < 0 || !body.subarray(0,5).equals(Buffer.from('HTTP/'))) return reject(Error('Invalid HTTPS headers'));
          headerBytes += end + 4;
          if (headerBytes > 65536) return reject(Error('HTTPS headers too large'));
          const lines = body.subarray(0,end).toString().split('\r\n');
          const interim = /^HTTP\/\S+ 1\d\d\b/.test(lines[0]) || / 200 Connection established$/i.test(lines[0]);
          fields = new Headers();
          for (const line of lines.slice(1)) { const colon = line.indexOf(':'); if(colon>0 && ['x-request-id','request-id','cf-ray'].includes(line.slice(0,colon).toLowerCase())) fields.set(line.slice(0,colon),line.slice(colon+1).trim()); }
          body = body.subarray(end+4);
          if (!interim) break;
        } while (body.length);
        if (body.length > maxBytes) return reject(Object.assign(Error('HTTPS transport failed'),{code:'RESPONSE_TOO_LARGE'}));
        resolve(new Response([204,205,304].includes(status) ? null : body, { status, headers:fields }));
      });
      // Only short header lines enter curl's config parser. Body is byte-preserving.
      child.stdin.end(headers);
      if (options.signal?.aborted) abort();
    });
  };
}
export const curlFetch = createCurlTransport();
