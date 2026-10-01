/**
 * Minimal Chrome DevTools Protocol client for the bundled headless browser.
 * Replaces the geckodriver/WebDriver tier: chrome-headless-shell is launched
 * with --remote-debugging-port=0 and driven over the DevTools websocket —
 * navigation, DOM assertions, clicks, screenshots and console-error capture
 * with a single binary and zero npm deps.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { findChromium, ensureBundledBrowser } from './browser-bin.mjs';

const MAX_ERRORS = 50;

/** Spawn the headless shell and return its browser-level DevTools ws URL. */
async function launchBrowser({ timeoutMs = 30000 } = {}) {
  let binary = findChromium();
  if (!binary) binary = await ensureBundledBrowser();
  const profile = mkdtempSync(join(tmpdir(), 'carthagent-chrome-'));
  const child = spawn(binary, [
    '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--mute-audio', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`browser did not expose DevTools within ${timeoutMs}ms: ${stderr.slice(-500)}`)), timeoutMs);
    child.stderr.on('data', () => {
      const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', () => { clearTimeout(timer); reject(Error(`browser exited before DevTools opened: ${stderr.slice(-500)}`)); });
  });
  return { child, wsUrl, profile };
}

/** Minimal CDP session over one websocket, scoped to a page target. */
async function connectSession(wsUrl, { timeoutMs = 15000 } = {}) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const errors = [];
  let dropped = 0;
  let sequence = 0;
  let sessionId;
  let closed = false;
  socket.addEventListener('close', () => { closed = true; });
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.id !== undefined) {
      const handler = pending.get(message.id);
      if (handler) { pending.delete(message.id); handler(message); }
      return;
    }
    const { method, params } = message;
    let entry;
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      entry = { type: 'console', text: (params.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 2000) };
    } else if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails || {};
      entry = { type: 'exception', text: String(d.exception?.description || d.text || 'uncaught exception').slice(0, 2000),
        stack: (d.stackTrace?.callFrames || []).slice(0, 8).map(f => ({ url: String(f.url).slice(0, 500), lineNumber: f.lineNumber, columnNumber: f.columnNumber })) };
    } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
      entry = { type: params.entry.source, text: String(params.entry.text ?? '').slice(0, 2000) };
    }
    if (!entry) return;
    if (errors.length === MAX_ERRORS) { dropped++; return; }
    errors.push(entry);
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('DevTools connection timed out')), timeoutMs);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('DevTools connection failed')); }, { once: true });
  });
  function send(method, params = {}, session) {
    if (closed) return Promise.reject(Error('DevTools connection closed'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP ${method} timed out`)); }, timeoutMs);
      pending.set(id, message => {
        clearTimeout(timer);
        if (message.error) reject(Error(`CDP ${method}: ${message.error.message}`));
        else resolve(message.result);
      });
      socket.send(JSON.stringify(session ? { id, method, params, sessionId: session } : { id, method, params }));
    });
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const attached = await send('Target.attachToTarget', { targetId, flatten: true });
  sessionId = attached.sessionId;
  const cmd = (method, params) => send(method, params, sessionId);
  await Promise.all([cmd('Page.enable'), cmd('Runtime.enable'), cmd('Log.enable'), cmd('Page.setLifecycleEventsEnabled', { enabled: true })]);
  return {
    send, cmd, sessionId, targetId,
    errors, dropped: () => dropped,
    navigate(url) {
      // Resolve on loadEventFired; caller applies the navigation timeout.
      const loaded = new Promise(resolve => {
        const listener = event => {
          let message;
          try { message = JSON.parse(event.data); } catch { return; }
          if (message.method === 'Page.loadEventFired' && message.sessionId === sessionId) {
            socket.removeEventListener('message', listener);
            resolve();
          }
        };
        socket.addEventListener('message', listener);
      });
      return { loaded, navigating: cmd('Page.navigate', { url }) };
    },
    close() { socket.close(); },
  };
}

function evaluateExpression(cmd, expression) {
  return cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false })
    .then(r => {
      if (r.exceptionDetails) throw Object.assign(Error(`page eval failed: ${r.exceptionDetails.text}`), { webdriverCode: 'eval error' });
      return r.result?.value;
    });
}

/**
 * Real-browser check over CDP — mirrors the webdriverCheck contract:
 * navigate, poll selector/text assertions, click once, screenshot, then fail on
 * captured console/page errors. Categories: launch, capture, navigation,
 * assertion, interaction, screenshot, cleanup.
 */
export async function cdpCheck({ url, steps = [], screenshot, waitMs = 5000 }) {
  if (!Number.isInteger(waitMs) || waitMs < 1 || waitMs > 60000) throw Object.assign(Error('waitMs must be an integer from 1 to 60000'), { category: 'configuration' });
  let phase = 'launch';
  let stepIndex;
  let currentStep;
  let failure;
  let browser;
  try {
    browser = await launchBrowser();
  } catch (error) {
    throw Object.assign(error, { category: 'launch' });
  }
  let session;
  try {
    phase = 'capture';
    session = await connectSession(browser.wsUrl);
    phase = 'navigation';
    const { loaded, navigating } = session.navigate(url);
    await Promise.race([
      Promise.all([navigating, loaded]),
      new Promise((_, reject) => setTimeout(() => reject(Error('page load timed out')), 15000)),
    ]);
    for (const [index, step] of steps.entries()) {
      phase = 'assertion'; stepIndex = index; currentStep = step;
      const deadline = Date.now() + waitMs;
      const sel = JSON.stringify(step.selector);
      for (;;) {
        try {
          if (step.text !== undefined) {
            const text = await evaluateExpression(session.cmd, `document.querySelector(${sel})?.innerText ?? null`);
            if (text == null) throw Object.assign(Error(`${step.selector}: not found`), { webdriverCode: 'no such element' });
            if (!String(text).includes(step.text)) throw Object.assign(Error(`${step.selector}: expected ${JSON.stringify(step.text)}, got ${JSON.stringify(String(text).slice(0, 200))}`), { webdriverCode: 'text mismatch' });
          } else {
            const found = await evaluateExpression(session.cmd, `!!document.querySelector(${sel})`);
            if (!found) throw Object.assign(Error(`${step.selector}: not found`), { webdriverCode: 'no such element' });
          }
          break;
        } catch (error) {
          if (!['no such element', 'text mismatch', 'eval error'].includes(error.webdriverCode) || Date.now() >= deadline) throw error;
          await new Promise(r => setTimeout(r, Math.min(100, Math.max(1, deadline - Date.now()))));
        }
      }
      if (step.action === 'click') {
        phase = 'interaction';
        await evaluateExpression(session.cmd, `document.querySelector(${sel})?.click()`);
      }
    }
    stepIndex = undefined; currentStep = undefined; phase = 'screenshot';
    if (screenshot) {
      const shot = await session.cmd('Page.captureScreenshot', { format: 'png' });
      mkdirSync(dirname(screenshot), { recursive: true });
      writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
    }
  } catch (error) {
    failure = Object.assign(error, { category: phase, stepIndex, selector: currentStep?.selector, expected: currentStep?.text });
  }
  if (session) {
    try {
      // Round trip on the same channel before consuming the observed log.
      await session.cmd('Runtime.evaluate', { expression: 'true' });
      if (session.errors.length) failure ||= Object.assign(Error('Unexpected browser errors'), { category: 'browser-errors' });
    } catch (error) { failure ||= Object.assign(error, { category: 'capture' }); }
    if (failure && session.errors.length) Object.assign(failure, { browserErrors: [...session.errors], droppedBrowserErrors: session.dropped() });
  }
  phase = 'cleanup';
  try { session?.close(); } catch {}
  try { browser.child.kill('SIGKILL'); } catch {}
  try { rmSync(browser.profile, { recursive: true, force: true }); } catch {}
  if (failure) throw failure;
  return { pass: true, engine: 'chrome-headless-shell', screenshot: screenshot || null, consoleChecked: true };
}
