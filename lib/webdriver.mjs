import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { captureBrowserErrors } from './browser-errors.mjs';

/** Bounded W3C WebDriver checks with mandatory pre-navigation BiDi error capture. */
export async function webdriverCheck({ endpoint, url, steps = [], screenshot, waitMs = 5000 }) {
  if (!Number.isInteger(waitMs) || waitMs < 1 || waitMs > 60000) throw Object.assign(Error('waitMs must be an integer from 1 to 60000'), { category: 'configuration' });
  let deadline;
  let phase = 'driver';
  let stepIndex;
  let currentStep;
  const base = endpoint.replace(/\/$/, '');
  async function request(path, method = 'GET', body) {
    const response = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(deadline ? Math.max(1, Math.min(20000, deadline - Date.now())) : 20000)
    });
    const data = await response.json();
    if (!response.ok || data.value?.error) throw Object.assign(Error(data.value?.message || `WebDriver HTTP ${response.status}`), { webdriverCode: data.value?.error });
    return data.value;
  }
  const session = await request('/session', 'POST', { capabilities: { alwaysMatch: {
    browserName: 'firefox', webSocketUrl: true, 'moz:firefoxOptions': { args: ['-headless'] }
  } } });
  const prefix = `/session/${session.sessionId}`;
  let failure;
  let capture;
  let diagnostics;
  try {
    phase = 'capture';
    capture = await captureBrowserErrors(session.capabilities.webSocketUrl);
    await request(prefix + '/timeouts', 'POST', { implicit: 0, pageLoad: 15000, script: 5000 });
    phase = 'navigation';
    await request(prefix + '/url', 'POST', { url });
    for (const [index, step] of steps.entries()) {
      phase = 'assertion'; stepIndex = index; currentStep = step;
      deadline = Date.now() + waitMs;
      let id;
      for (;;) {
        try {
          const element = await request(prefix + '/element', 'POST', { using: 'css selector', value: step.selector });
          id = element['element-6066-11e4-a52e-4f735466cecf'];
          if (step.text !== undefined) {
            const text = await request(`${prefix}/element/${id}/text`);
            if (!text.includes(step.text)) throw Object.assign(Error(`${step.selector}: expected ${JSON.stringify(step.text)}, got ${JSON.stringify(text)}`), { webdriverCode: 'text mismatch' });
          }
          break;
        } catch (error) {
          if (!['no such element', 'stale element reference', 'text mismatch'].includes(error.webdriverCode) || Date.now() >= deadline) throw error;
          await new Promise(r => setTimeout(r, Math.min(100, Math.max(1, deadline - Date.now()))));
        }
      }
      deadline = undefined;
      if (step.action === 'click') {
        phase = 'interaction';
        await request(`${prefix}/element/${id}/click`, 'POST', {});
      }
    }
    stepIndex = undefined; currentStep = undefined; phase = 'screenshot';
    if (screenshot) {
      const png = await request(prefix + '/screenshot');
      mkdirSync(dirname(screenshot), { recursive: true });
      writeFileSync(screenshot, Buffer.from(png, 'base64'));
    }
  } catch (error) {
    failure = Object.assign(error, { category: phase, stepIndex, selector: currentStep?.selector, expected: currentStep?.text });
  }
  deadline = undefined;
  if (capture) {
    try {
      diagnostics = await capture.inspect();
      if (diagnostics.errors.length) failure ||= Object.assign(Error('Unexpected browser errors'), { category: 'browser-errors' });
    } catch (error) { failure ||= Object.assign(error, { category: 'capture' }); }
    finally { capture.close(); }
  }
  if (failure && diagnostics) Object.assign(failure, { browserErrors: diagnostics.errors, droppedBrowserErrors: diagnostics.dropped });
  try { await request(prefix, 'DELETE'); }
  catch (error) { failure ||= Object.assign(Error(`Session cleanup failed: ${error.message}`), { category: 'cleanup' }); }
  if (failure) throw failure;
  return { pass: true, engine: 'firefox-webdriver', browserVersion: session.capabilities.browserVersion, screenshot: screenshot || null, consoleChecked: true };
}
