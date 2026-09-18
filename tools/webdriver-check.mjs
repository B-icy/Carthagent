#!/usr/bin/env node
import { resolve } from 'node:path';
import { webdriverCheck } from '../lib/webdriver.mjs';
import { serveDir } from '../lib/browser.mjs';

let server;
try {
  const args = process.argv.slice(2);
  const options = {};
  const steps = [];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!['--endpoint', '--root', '--page', '--url', '--wait-ms', '--assert', '--assert-text', '--click', '--screenshot'].includes(key) || value === undefined || value.startsWith('--')) throw Error(`Unsupported or missing option: ${key}`);
    if (key === '--assert' || key === '--click') steps.push({ selector: value, action: key === '--click' ? 'click' : undefined });
    else if (key === '--assert-text') {
      const split = value.indexOf(':');
      if (split < 1) throw Error('Expected --assert-text selector:text');
      steps.push({ selector: value.slice(0, split), text: value.slice(split + 1) });
    } else options[key.slice(2)] = value;
  }
  if (!options.endpoint || !steps.length) throw Error('Require --endpoint http://127.0.0.1:4444 and at least one assertion or click');
  if (options.url && (options.root || options.page)) throw Error('--url cannot be combined with --root or --page');
  const waitMs = options['wait-ms'] === undefined ? 5000 : Number(options['wait-ms']);
  if (!Number.isInteger(waitMs) || waitMs < 1 || waitMs > 60000) throw Error('--wait-ms must be an integer from 1 to 60000');
  let url;
  if (options.url) {
    const parsed = new URL(options.url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw Error('--url requires HTTP or HTTPS');
    url = parsed.href;
  } else {
    server = await serveDir(resolve(options.root || '.'));
    url = new URL(options.page || 'index.html', server.url + '/').href;
    if (new URL(url).origin !== server.url) throw Error('--page must address the local served workspace');
  }
  let result;
  try { result = await webdriverCheck({ endpoint: options.endpoint, url, steps, waitMs, screenshot: options.screenshot && resolve(options.screenshot) }); }
  catch (error) { error.category ||= 'driver'; throw error; }
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ pass: false, error: error.message, category: error.category || 'configuration', stepIndex: error.stepIndex, selector: error.selector, expected: error.expected, browserErrors: error.browserErrors, droppedBrowserErrors: error.droppedBrowserErrors }));
  process.exitCode = 1;
} finally { server?.close(); }
