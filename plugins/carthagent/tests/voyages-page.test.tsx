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
    client: { rpc: () => ({ snapshot: async () => ({ accountKey: "a".repeat(64), profile, items: [{ item: "hat:beanie", itemKey: "beanie", name: "Beanie", slot: "hat", price: 40, requiresPurchase: true, available: true, eligible: true, reason: null }] }), quote: async () => writes.push("quote"), equip: async () => writes.push("equip") }) },
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
    client: { rpc: () => ({ snapshot: async () => { reads++; return { accountKey: "a".repeat(64), profile, items: catalog }; }, quote: async () => writes.push("quote"), equip: async () => writes.push("equip"), purchase: async () => writes.push("purchase"), customize: async () => writes.push("customize"), previewReward: async () => writes.push("previewReward"), claimReward: async () => writes.push("claim") }) },
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

// Catalog item IDs are shared by every account, so an item ID alone never proves the reload belongs to the same captain.
async function identityFixture(accountKey: () => string | undefined) {
  const writes: string[] = [];
  let cleared = 0;
  let listener: ((event: { details: { type: string; data?: unknown } }) => void) | undefined;
  let gate: Promise<void> | undefined;
  let release = () => {};
  const rich = { ...profile, coins: 1000 };
  const quote = { id: "quote-1", item: "sail:i3", price: 400, expiresAt: "2999-01-01T00:00:00Z" };
  const context = {
    theme: resolveThemeDocument(parseThemeDocument(theme), "dark"), location: { directory: "/review" },
    data: { session: { get: () => undefined }, location: { default: () => ({ directory: "/review" }) }, listen: (next: typeof listener) => { listener = next; return () => {}; } },
    client: { rpc: () => ({
      snapshot: async () => { if (gate) await gate; const key = accountKey(); return { ...(key ? { accountKey: key } : {}), profile: rich, items: catalog }; },
      quote: async () => { writes.push("quote"); return { quote }; }, equip: async () => writes.push("equip"), purchase: async () => writes.push("purchase"), retryPurchase: async () => writes.push("retryPurchase"), customize: async () => writes.push("customize"),
    }) },
    keymap: { layer: () => {}, mode: { current: () => "base" } },
    ui: { router: { navigate: () => writes.push("navigate") }, dialog: { clear: () => { cleared++; }, confirm: () => new Promise(() => {}) } },
  } as unknown as Context;
  const app = await testRender(() => <PluginContextProvider value={context}><VoyagesPage section="equipment" /></PluginContextProvider>, { width: 110, height: 36 });
  const settle = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); await app.renderOnce(); } };
  await settle();
  const find = (node: Renderable): SelectRenderable | undefined => node instanceof SelectRenderable ? node : node.getChildren().map(find).find(Boolean);
  const list = () => find(app.renderer.root)!;
  const choose = async (value: string) => { list().setSelectedIndex(list().options.findIndex(o => o.value === value)); list().selectCurrent(); await settle(); };
  const highlight = async (value: string) => { list().setSelectedIndex(list().options.findIndex(o => o.value === value)); await settle(); };
  await choose("category:sail");
  await choose("item:sail:i3");
  await highlight("buy-preview");
  return {
    app, list, settle, writes, cleared: () => cleared,
    hold: () => { gate = new Promise(resolve => { release = () => { gate = undefined; resolve(); }; }); },
    release: async () => { release(); await settle(); },
    event: (type: string, data?: unknown) => listener?.({ details: { type, data } }),
  };
}
const previewShown = (frame: string) => frame.includes("Preview · choose Equip or Buy to save") || frame.includes("sail item 3");

test.each(["same", "changed", "unknown", "switched"])("a disconnect followed by reconnect checks the %s account before restoring the preview", async (binding) => {
  let account: string | undefined = "a".repeat(64);
  const f = await identityFixture(() => account);
  try {
    expect(previewShown(f.app.captureCharFrame())).toBe(true);
    f.event("server.disconnected");
    await f.settle();
    expect(previewShown(f.app.captureCharFrame())).toBe(false);
    if (binding === "changed") account = "b".repeat(64);
    if (binding === "unknown") account = undefined;
    f.hold();
    if (binding === "switched") f.event("credential.switched", { integrationID: "carthagent-cloud" });
    f.event("server.connected");
    await f.settle();
    expect(previewShown(f.app.captureCharFrame())).toBe(false);
    await f.release();
    expect(previewShown(f.app.captureCharFrame())).toBe(binding === "same");
    expect(f.writes).toEqual([]);
  } finally { f.app.renderer.destroy(); }
});

test("same-account reload restores the preview and its action only after the account binding matches", async () => {
  const f = await identityFixture(() => "a".repeat(64));
  try {
    expect(f.list().getSelectedOption()?.value).toBe("buy-preview");
    f.hold();
    f.event("credential.updated");
    await f.settle();
    // Cleared synchronously and kept clear until the reload is verified: no old title, preview or Buy action.
    expect(previewShown(f.app.captureCharFrame())).toBe(false);
    expect(f.list().options.some(o => o.value === "buy-preview")).toBe(false);
    await f.release();
    expect(previewShown(f.app.captureCharFrame())).toBe(true);
    expect(f.list().getSelectedOption()?.value).toBe("buy-preview");
    expect(f.writes).toEqual([]);
  } finally { f.app.renderer.destroy(); }
});

test.each(["credential.updated", "provider.updated", "integration.updated", "server.connected"])("a changed account binding after %s never restores the shared-ID preview, Buy action or category", async (type) => {
  let key = "a".repeat(64);
  const f = await identityFixture(() => key);
  try {
    key = "b".repeat(64);
    f.hold();
    f.event(type);
    await f.settle();
    expect(previewShown(f.app.captureCharFrame())).toBe(false);
    await f.release();
    expect(previewShown(f.app.captureCharFrame())).toBe(false);
    expect(f.list().options.some(o => o.value === "buy-preview" || o.value === "back")).toBe(false);
    expect(f.list().getSelectedOption()?.value).toBe("category:hairStyle");
    expect(f.writes).toEqual([]);
  } finally { f.app.renderer.destroy(); }
});

test("an unknown account binding fails closed", async () => {
  let key: string | undefined = "a".repeat(64);
  const f = await identityFixture(() => key);
  try {
    key = undefined;
    f.event("credential.updated");
    await f.settle();
    expect(previewShown(f.app.captureCharFrame())).toBe(false);
    expect(f.list().getSelectedOption()?.value).toBe("category:hairStyle");
    expect(f.writes).toEqual([]);
  } finally { f.app.renderer.destroy(); }
});

test("an open Buy confirmation closes synchronously on reload and nothing is sent", async () => {
  const f = await identityFixture(() => "a".repeat(64));
  try {
    f.list().selectCurrent();
    await f.settle();
    expect(f.writes).toEqual(["quote"]);
    const before = f.cleared();
    f.event("credential.updated");
    expect(f.cleared()).toBeGreaterThan(before);
    await f.settle();
    expect(f.writes).toEqual(["quote"]);
  } finally { f.app.renderer.destroy(); }
});

test("/voyages claim opens the reward preview and still waits for explicit confirmation", async () => {
  const calls: string[] = [];
  const preview = { runId: "run-1", snapshot: "snap", coins: 25, xp: 100, km: 1, dailyLimit: 3 };
  const context = {
    theme: resolveThemeDocument(parseThemeDocument(theme), "dark"), location: { directory: "/review" },
    data: { session: { get: () => undefined }, location: { default: () => ({ directory: "/review" }) }, listen: () => () => {} },
    client: { rpc: () => ({ snapshot: async () => ({ accountKey: "a".repeat(64), profile, items: [] }), previewReward: async (input: unknown) => { calls.push(`preview:${JSON.stringify(input)}`); return preview; }, claimReward: async () => { calls.push("claim"); return { reward: {}, replayed: false }; } }) },
    keymap: { layer: () => {}, mode: { current: () => "base" } },
    ui: { router: { navigate: () => {} }, dialog: { clear: () => {}, confirm: async (input: { message: string }) => { calls.push(`confirm:${input.message.split("\n")[0]}`); return false; } } },
  } as unknown as Context;
  const app = await testRender(() => <PluginContextProvider value={context}><VoyagesPage section="profile" sessionID="s1" claim /></PluginContextProvider>, { width: 110, height: 36 });
  try {
    for (let i = 0; i < 12; i++) { await Promise.resolve(); await app.renderOnce(); }
    expect(calls).toEqual([`preview:${JSON.stringify({ sessionID: "s1" })}`, "confirm:+25 coins · +100 XP · +1 km"]);
  } finally { app.renderer.destroy(); }
});
