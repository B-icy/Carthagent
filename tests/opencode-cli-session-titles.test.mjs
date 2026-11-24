import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createOpenCodeCliRuntime as createRuntime } from '../lib/opencode/cli-runtime.mjs';

// Offline fixtures: never let a fixture URL reach the operating-system browser launcher.
const createOpenCodeCliRuntime = options => createRuntime({ openBrowserImpl: async () => false, ...options });
test('native CLI session titles preserve Unicode at the 80-code-unit boundary', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const cwd = mkdtempSync(join(tmpdir(), 'ctg-title-boundary-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const scalar = '\u{1F680}';
  const cases = [
    ['a'.repeat(79) + scalar + ' tail', 'a'.repeat(79)],
    ['a'.repeat(78) + scalar + ' tail', 'a'.repeat(78) + scalar],
    ['a'.repeat(81), 'a'.repeat(80)],
    ['短い title', '短い title'],
  ];
  for (const [name, mode, options] of [
    ['interactive with session options', 'interactive', { autoFraming: false }],
    ['interactive with a starting prompt', 'interactive', {}],
    ['headless', 'headless', {}],
  ]) {
    await t.test(name, async () => {
      const titles = [];
      const runtime = await createOpenCodeCliRuntime({
        cwd,
        stdout: { write() {} },
        native: {
          runtime: {},
          service: {
            ensureService: async () => ({}),
            launchTui: () => ({
              once(event, callback) {
                if (event === 'exit') queueMicrotask(() => callback(0));
                return this;
              },
              kill() {},
            }),
          },
          rpcDefinitions: { Carthagent: {}, SessionControls: {} },
          clientFactory: async () => ({ rpc: () => ({ health: async () => ({ capabilities: ['delivery.session-options.v1'] }), framing: async () => {} }) }),
          headless: {
            createSession: async (_service, _cwd, { body }) => {
              titles.push(body.title);
              return { id: 'ses_title' };
            },
            promptSession: async () => {},
            runHeadless: async (_service, _cwd, _prompt, { session }) => {
              titles.push(session.title);
              return {
                session: { id: 'ses_title' },
                outcome: 'succeeded',
                terminal: true,
                messages: [{ type: 'assistant', finish: 'stop', parts: [{ type: 'text', text: 'ok' }] }],
              };
            },
          },
        },
      });
      for (const [prompt, expected] of cases) {
        assert.equal(await runtime.run({ mode, options: { ...options, prompt }, prompt }), 0);
        assert.equal(titles.shift(), expected);
        assert.equal(titles.length, 0);
      }
    });
  }
});
