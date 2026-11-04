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
