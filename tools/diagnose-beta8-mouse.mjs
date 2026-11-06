import { readFileSync, writeFileSync } from 'node:fs';
const file = 'packages/tui/test/navigation-rail.test.tsx';
const source = readFileSync(file, 'utf8');
const old = `  await setup.mockMouse.click(text.indexOf("Rename") + 1, line)
  await setup.waitForFrame((frame) => frame.includes("Rename session") && frame.includes("Navigation session 1"))`;
const diagnostic = `  const events: unknown[] = []
  const renderer = setup.renderer as any
  const send = renderer.sendMouseEvent.bind(renderer)
  renderer.sendMouseEvent = (target: any, event: any) => {
    events.push({ type: event.type, x: event.x, y: event.y, target: target.id, text: target.plainText, parent: target.parent?.id })
    return send(target, event)
  }
  try {
    await setup.mockMouse.click(text.indexOf("Rename") + 1, line)
    await setup.waitForFrame((frame) => frame.includes("Rename session") && frame.includes("Navigation session 1"))
  } catch (error) {
    console.error("RENAME_MOUSE_DIAGNOSTIC", JSON.stringify({ line, text, events, logs: setup.logs }))
    throw error
  }`;
if (!source.includes(old)) throw new Error('Expected exact Rename test sequence');
writeFileSync(file, source.replace(old, diagnostic));
