/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { SelectRenderable, type Renderable } from "@opentui/core";
import { PluginContextProvider } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import { parseThemeDocument, resolveThemeDocument } from "@opencode/theme/tui";
import theme from "../themes/carthage.json";
import { VoyagesPage } from "../src/ui/voyages.js";

const profile = { version: 1, name: "Dido", shipName: "North Star", coins: 10, level: 2, totalXp: 150, xpIntoLevel: 50, xpForLevel: 200, km: 8, weeklyKm: 8, owned: [], config: { skin: "warm", hair: "dark", pattern: "stripes", hairStyle: "cropped", hat: "none", shirt: "none", bottoms: "underwear", shoes: "barefoot", pet: "none", hull: "cedar", sail: "gold", setting: "dusk" } };
test.each([[110, 36], [80, 24], [60, 20]])("shop previews and back navigation work without writes at %ix%i", async (width, height) => {
  const writes: string[] = [], routes: unknown[] = [];
  let layer: () => { commands: { bind: string; run: () => void }[] };
  const context = {
    theme: resolveThemeDocument(parseThemeDocument(theme), "dark"), location: { directory: "/review" },
    data: { session: { get: () => undefined }, location: { default: () => ({ directory: "/review" }) }, listen: () => () => {} },
    client: { rpc: () => ({ snapshot: async () => ({ profile, items: [{ item: "hat:beanie", itemKey: "beanie", name: "Beanie", slot: "hat", price: 40, requiresPurchase: true, available: true, eligible: true, reason: null }] }), quote: async () => writes.push("quote"), equip: async () => writes.push("equip") }) },
    keymap: { layer: (value: typeof layer) => { layer = value; }, mode: { current: () => "base" } },
    ui: { router: { navigate: (route: unknown) => routes.push(route) }, dialog: { clear: () => {} } },
  } as unknown as Context;
  const app = await testRender(() => <PluginContextProvider value={context}><VoyagesPage section="equipment" /></PluginContextProvider>, { width, height });
  const settle = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); await app.renderOnce(); } };
  const find = (node: Renderable): SelectRenderable | undefined => node instanceof SelectRenderable ? node : node.getChildren().map(find).find(Boolean);
  const choose = async (value: string) => { const list = find(app.renderer.root)!; list.setSelectedIndex(list.options.findIndex(item => item.value === value)); list.selectCurrent(); await settle(); };
  const back = async () => { layer().commands.find(c => c.bind === "escape")!.run(); await settle(); };
  try {
    await settle();
    expect(app.captureCharFrame()).toContain("Shop");
    expect(app.captureCharFrame()).toContain("▀");
    await choose("category:hat");
    expect(app.captureCharFrame()).toContain("Beanie");
    await choose("item:hat:beanie");
    expect(app.captureCharFrame()).toContain("Back to items");
    expect(find(app.renderer.root)!.options.map(o => o.value)).toEqual(["back"]);
    expect(find(app.renderer.root)!.y + find(app.renderer.root)!.height).toBeLessThan(height);
    await back(); expect(app.captureCharFrame()).toContain("Back to categories");
    await back(); expect(app.captureCharFrame()).toContain("Shop");
    expect(writes).toEqual([]); expect(routes).toEqual([]);
    expect(app.captureCharFrame()).not.toContain("opencode");
  } finally { app.renderer.destroy(); }
});

const slots = ["hairStyle", "hat", "shirt", "bottoms", "shoes", "pet", "hull", "sail", "setting"] as const;
const catalog = slots.flatMap(slot => [1, 2, 3, 4, 5, 6].map(n => ({ item: `${slot}:i${n}`, itemKey: `i${n}`, name: `${slot} item ${n}`, slot, price: 400, requiresPurchase: true, available: true, eligible: true, reason: null })));
async function shopFixture(section: "equipment" | "profile" = "equipment", width = 110, height = 36) {
  const writes: string[] = [], routes: unknown[] = [];
  let listener: ((event: { details: { type: string; data?: unknown } }) => void) | undefined;
  let reads = 0;
  const context = {
    theme: resolveThemeDocument(parseThemeDocument(theme), "dark"), location: { directory: "/review" },
    data: { session: { get: () => undefined }, location: { default: () => ({ directory: "/review" }) }, listen: (next: typeof listener) => { listener = next; return () => {}; } },
    client: { rpc: () => ({ snapshot: async () => { reads++; return { profile, items: catalog }; }, quote: async () => writes.push("quote"), equip: async () => writes.push("equip"), purchase: async () => writes.push("purchase"), customize: async () => writes.push("customize"), previewReward: async () => writes.push("previewReward"), claimReward: async () => writes.push("claim") }) },
    keymap: { layer: () => {}, mode: { current: () => "base" } },
    ui: { router: { navigate: (route: unknown) => routes.push(route) }, dialog: { clear: () => {}, confirm: async () => { writes.push("confirm"); return false; }, select: async () => { writes.push("dialog"); return undefined; } } },
  } as unknown as Context;
  const app = await testRender(() => <PluginContextProvider value={context}><VoyagesPage section={section} sessionID="s1" /></PluginContextProvider>, { width, height });
  const settle = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); await app.renderOnce(); } };
  await settle();
  const find = (node: Renderable): SelectRenderable | undefined => node instanceof SelectRenderable ? node : node.getChildren().map(find).find(Boolean);
  const list = () => find(app.renderer.root)!;
  const rowOf = (label: string) => app.captureCharFrame().split("\n").findIndex(line => line.replace(/[█▀▄]/g, "").trim().replace(/^▶ /, "") === label);
  const click = async (label: string) => { const row = rowOf(label); if (row < 0) throw new Error(`${label} not visible:\n${app.captureCharFrame()}`); await app.mockMouse.click(list().x + 4, row); await settle(); };
  const wheel = async (direction: "up" | "down", times = 1) => { for (let i = 0; i < times; i++) await app.mockMouse.scroll(list().x + 4, list().y + 1, direction); await settle(); };
  return { app, list, rowOf, click, wheel, settle, writes, routes, reads: () => reads, event: (type: string, data?: unknown) => listener?.({ details: { type, data } }) };
}

test("wheel reaches every hidden Shop category without activating, and a click opens the row under the pointer", async () => {
  const f = await shopFixture();
  try {
    expect(f.rowOf("Hulls")).toBe(-1);
    await f.wheel("down", 10);
    expect(f.routes).toEqual([]); expect(f.writes).toEqual([]);
    for (const label of ["Hulls", "Sails", "Harbours", "Character", "Refresh"]) expect(f.rowOf(label)).toBeGreaterThanOrEqual(0);
    await f.click("Sails");
    expect(f.app.captureCharFrame()).toContain("Back to categories");
    expect(f.list().options.some(o => o.value === "item:sail:i1")).toBe(true);
    await f.wheel("down", 6);
    expect(f.rowOf("Shop · sail item 6 · 400 coins · need 390 more")).toBeGreaterThanOrEqual(0);
    await f.click("Shop · sail item 6 · 400 coins · need 390 more");
    expect(f.app.captureCharFrame()).toContain("Back to items");
    expect(f.writes).toEqual([]); expect(f.routes).toEqual([]);
  } finally { f.app.renderer.destroy(); }
});

test("clicking a visible row keeps the list window still, so the next click hits what is drawn", async () => {
  const f = await shopFixture("profile");
  try {
    await f.wheel("down", 6);
    const before = f.app.captureCharFrame();
    const refreshRow = f.rowOf("Refresh");
    expect(refreshRow).toBeGreaterThanOrEqual(0);
    await f.click("Refresh");
    expect(f.reads()).toBe(2);
    expect(f.rowOf("Refresh")).toBe(refreshRow);
    const shopRow = f.rowOf("Shop");
    expect(shopRow).toBeGreaterThanOrEqual(0);
    expect(before.split("\n")[shopRow]).toContain("Shop");
    await f.click("Shop");
    expect(f.routes).toEqual([{ type: "plugin", name: "voyages", data: { sessionID: "s1", section: "equipment" } }]);
    expect(f.writes).toEqual([]);
  } finally { f.app.renderer.destroy(); }
});

test("same-account reload keeps the chosen category and its window; a credential switch returns to the top", async () => {
  const f = await shopFixture();
  try {
    await f.wheel("down", 7);
    expect(f.list().getSelectedOption()?.value).toBe("category:sail");
    const row = f.rowOf("Sails");
    expect(row).toBeGreaterThanOrEqual(0);
    f.event("provider.updated");
    await f.settle();
    expect(f.reads()).toBe(2);
    expect(f.list().getSelectedOption()?.value).toBe("category:sail");
    expect(f.rowOf("Sails")).toBe(row);
    f.event("credential.switched", { integrationID: "experiential-labs" });
    await f.settle();
    expect(f.list().getSelectedOption()?.value).toBe("category:hairStyle");
    expect(f.writes).toEqual([]); expect(f.routes).toEqual([]);
  } finally { f.app.renderer.destroy(); }
});
