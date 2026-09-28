import { spawn } from 'node:child_process';
import { safeEnv } from './runtime.mjs';
// Credentials and payload travel over anonymous pipes, never argv or temporary files.
// Every request has a fresh curl/OpenSSL process: no Node TLS or connection reuse.
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
    const args = ['-q', '--silent', '--show-error', '--http1.1', '--proto', allowLoopbackHttp ? '=http,https' : '=https', '--max-redirs', '0', '--connect-timeout', '15', '--max-time', String(timeoutMs / 1000), '--retry', '0', '--request', options.method || 'POST', '--config', '-', '--write-out', '\n%{http_code}', ...(caFile ? ['--cacert', caFile] : []), '--url', target.href];
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { env: safeEnv(), stdio: ['pipe','pipe','pipe'] });
      let chunks = [], bytes = 0, failure;
      const fail = (code) => { failure ||= Object.assign(Error('HTTPS transport failed'), { code }); child.kill('SIGKILL'); };
      const abort = () => fail('ABORTED');
      const timer = setTimeout(() => fail('TRANSPORT_TIMEOUT'), timeoutMs + 1000);
      options.signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', b => { bytes += b.length; if (bytes > maxBytes + 4) fail('RESPONSE_TOO_LARGE'); else chunks.push(b); });
      // Drain but do not expose curl stderr, which can include server-controlled content.
      child.stderr.on('data', () => {});
      child.on('error', () => { failure ||= Object.assign(Error('HTTPS transport unavailable'), { code: 'TRANSPORT_SPAWN' }); });
      child.stdin.on('error', () => {});
      child.on('close', code => {
        clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
        if (failure || code !== 0) return reject(failure || Object.assign(Error('HTTPS transport failed'), { code: `CURL_${code}` }));
        const data = Buffer.concat(chunks), status = Number(data.subarray(-3).toString());
        if (data.at(-4) !== 10 || status < 200 || status > 599) return reject(Error('Invalid HTTPS status'));
        resolve(new Response([204,205,304].includes(status) ? null : data.subarray(0,-4), { status }));
      });
      // curl config accepts quoted backslash, quote, newline, CR and tab escapes.
      const quote = value => '"' + String(value).replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('\n','\\n').replaceAll('\r','\\r').replaceAll('\t','\\t') + '"';
      child.stdin.end(headers + 'data-binary = ' + quote(options.body || '') + '\n');
      if (options.signal?.aborted) abort();
    });
  };
}
export const curlFetch = createCurlTransport();
