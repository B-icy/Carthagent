import { readFileSync, writeFileSync } from 'node:fs';
const file = 'packages/tui/test/navigation-rail.test.tsx';
const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
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
const menuOld = `    await setup.mockMouse.click(row.x + 3, row.y, MouseButton.RIGHT)
    await setup.waitForFrame((frame) => frame.includes("Copy session ID"))`;
const menuTrace = `    const mouseEvents: unknown[] = []
    const renderer = setup.renderer as any
    const send = renderer.sendMouseEvent.bind(renderer)
    renderer.sendMouseEvent = (target: any, event: any) => {
      mouseEvents.push({ type: event.type, x: event.x, y: event.y, target: target.id, text: target.plainText, parent: target.parent?.id })
      return send(target, event)
    }
    try {
      await setup.mockMouse.click(row.x + 3, row.y, MouseButton.RIGHT)
      await setup.waitForFrame((frame) => frame.includes("Copy session ID"))
    } catch (error) {
      console.error("OPEN_MENU_DIAGNOSTIC", JSON.stringify({ sessionID, row: { x: row.x, y: row.y }, mouseEvents, logs: setup.logs }))
      throw error
    } finally { renderer.sendMouseEvent = send }`;
if (!source.includes(menuOld)) throw new Error('Expected exact open-menu sequence');
const settled = source.replace('  const openMenu = async (sessionID: string) => {', `  const openMenu = async (sessionID: string) => {
    await setup.flush()`);
writeFileSync(file, settled.replace(old, diagnostic).replace(menuOld, menuTrace));
