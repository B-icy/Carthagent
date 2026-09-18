import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Bounded W3C WebDriver checks. No jsdom fallback or implied console coverage. */
export async function webdriverCheck({ endpoint, url, steps = [], screenshot }) {
  const base = endpoint.replace(/\/$/, '');
  async function request(path, method = 'GET', body) {
    const response = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
    const data = await response.json();
    if (!response.ok || data.value?.error) throw Error(data.value?.message || `WebDriver HTTP ${response.status}`);
    return data.value;
  }
  const session = await request('/session', 'POST', { capabilities: { alwaysMatch: {
    browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless'] }
  } } });
  const prefix = `/session/${session.sessionId}`;
  let failure;
  try {
    await request(prefix + '/timeouts', 'POST', { implicit: 2000, pageLoad: 15000, script: 5000 });
    await request(prefix + '/url', 'POST', { url });
    for (const step of steps) {
      const element = await request(prefix + '/element', 'POST', { using: 'css selector', value: step.selector });
      const id = element['element-6066-11e4-a52e-4f735466cecf'];
      if (step.action === 'click') await request(`${prefix}/element/${id}/click`, 'POST', {});
      else if (step.text !== undefined) {
        const text = await request(`${prefix}/element/${id}/text`);
        if (!text.includes(step.text)) throw Error(`${step.selector}: expected ${JSON.stringify(step.text)}, got ${JSON.stringify(text)}`);
      }
    }
    if (screenshot) {
      const png = await request(prefix + '/screenshot');
      mkdirSync(dirname(screenshot), { recursive: true });
      writeFileSync(screenshot, Buffer.from(png, 'base64'));
    }
  } catch (error) { failure = error; }
  try { await request(prefix, 'DELETE'); }
  catch (error) { failure ||= Error(`Session cleanup failed: ${error.message}`); }
  if (failure) throw failure;
  return { pass: true, engine: 'firefox-webdriver', browserVersion: session.capabilities.browserVersion, screenshot: screenshot || null, consoleChecked: false };
}
