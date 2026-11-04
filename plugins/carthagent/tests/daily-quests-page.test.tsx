/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { SelectRenderable, ScrollBoxRenderable, type Renderable } from "@opentui/core";
import { PluginContextProvider } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import { parseThemeDocument, resolveThemeDocument } from "@opencode/theme/tui";
import theme from "../themes/carthage.json";
import { DailyQuestsPage } from "../src/ui/daily-quests.js";

const quest = { id: "11111111-1111-4111-8111-111111111111", status: "open", endsAt: "2026-11-04T00:00:00Z", definition: {
  templateId: "change-behavior-v1", title: "Deliver a checked behavior change", kind: "change", rubricVersion: "v1",
  criteria: [{ id: "outcome", text: "Goal and achieved outcome" }, { id: "focus", text: "Specific behavior" }, { id: "validation", text: "Relevant check" }],
} };

test.each([[110, 36], [60, 20]])("completed quests leave the active board but remain readable at %ix%i", async (width, height) => {
  const items = [{ ...quest, status: "assessed_complete" }, { ...quest, id: "second", definition: { ...quest.definition, templateId: "tests-regression-v1" } }];
  let layer: () => { commands: { bind: string; run: () => void }[] };
  const reads: string[] = [];
  const context = {
    theme: resolveThemeDocument(parseThemeDocument(theme), "dark"), location: { directory: "/review" },
    data: { session: { get: () => undefined, list: () => [] }, location: { default: () => ({ directory: "/review" }) }, listen: () => () => {} },
    client: { rpc: () => ({ snapshot: async () => ({ accountKey: "a".repeat(64), slate: { endsAt: quest.endsAt, items }, records: [] }), detail: async ({ id }: { id: string }) => { reads.push(id); return { ...items.find(q => q.id === id), latestSubmission: null }; } }) },
    keymap: { layer: (value: typeof layer) => { layer = value; }, mode: { current: () => "base" } },
    ui: { router: { navigate: () => {} }, dialog: { clear: () => {} } },
  } as unknown as Context;
  const app = await testRender(() => <PluginContextProvider value={context}><DailyQuestsPage /></PluginContextProvider>, { width, height });
  const settle = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); await app.renderOnce(); } };
  const key = (bind: string) => layer().commands.find(c => c.bind === bind)!.run();
  try {
    await settle();
    expect(app.captureCharFrame()).not.toContain("Improve a behavior");
    expect(app.captureCharFrame()).toContain("Catch a regression");
    key("return"); await settle();
    expect(reads).toEqual(["second"]);
    key("escape"); key("c"); await settle();
    expect(app.captureCharFrame()).toContain("Completed quests");
    expect(app.captureCharFrame()).not.toContain("Catch a regression");
    key("return"); await settle();
    expect(app.captureCharFrame()).toContain("Quest complete");
    key("escape"); await settle();
    expect(app.captureCharFrame()).toContain("Completed quests");
    key("escape"); await settle();
    expect(app.captureCharFrame()).toContain("Catch a regression");
    items[1].status = "assessed_complete";
    key("r"); await settle();
    expect(app.captureCharFrame()).toContain("All quests complete");
    expect(app.captureCharFrame()).not.toContain("Catch a regression");
    key("c"); await settle();
    expect(app.captureCharFrame()).toContain("Improve a behavior");
  } finally { app.renderer.destroy(); }
});
test.each([[110, 36], [80, 24], [60, 20]])("quest detail keeps actions and footer inside a %ix%i terminal", async (width, height) => {
  const routes: unknown[] = [];
  const context = {
    theme: resolveThemeDocument(parseThemeDocument(theme), "dark"), location: { directory: "/review" },
    data: { session: { get: () => undefined, list: () => [] }, location: { default: () => ({ directory: "/review" }) }, listen: () => () => {} },
    client: { rpc: () => ({ snapshot: async () => ({ accountKey: "a".repeat(64), slate: { endsAt: quest.endsAt, items: [quest] }, records: [] }), detail: async () => ({ ...quest, latestSubmission: null }) }) },
    keymap: { layer: () => {}, mode: { current: () => "base" } },
    ui: { router: { navigate: (route: unknown) => routes.push(route) }, dialog: { clear: () => {} } },
  } as unknown as Context;
  const app = await testRender(() => <PluginContextProvider value={context}><DailyQuestsPage questID={quest.id} /></PluginContextProvider>, { width, height });
  try {
    for (let i = 0; i < 8; i++) { await Promise.resolve(); await app.renderOnce(); }
    const frame = app.captureCharFrame();
    expect(frame).toContain("Improve a behavior");
    expect(frame).toContain("What counts");
    expect(frame).toContain("Choose completed work");
    expect(frame).toContain("Esc back");
    expect(frame).not.toContain("rubric");
    expect(frame).not.toContain("opencode");
    const find = (node: Renderable): SelectRenderable | undefined => node instanceof SelectRenderable ? node : node.getChildren().map(find).find(Boolean);
    const actions = find(app.renderer.root)!;
    expect(actions.y + actions.height).toBeLessThan(height);
    expect(actions.height).toBe(3);
    expect(routes).toHaveLength(0);
  } finally { app.renderer.destroy(); }
});

test.each([[110, 36], [80, 24], [60, 20]])("quest cards keep keyboard selection visible at %ix%i", async (width, height) => {
  const items = [quest, { ...quest, id: "second", definition: { ...quest.definition, templateId: "tests-regression-v1" } }, { ...quest, id: "third", definition: { ...quest.definition, templateId: "review-correctness-v1" } }];
  let layer: () => { commands: { bind: string; run: () => void }[] };
  const context = {
    theme: resolveThemeDocument(parseThemeDocument(theme), "dark"), location: { directory: "/review" },
    data: { session: { get: () => undefined, list: () => [] }, location: { default: () => ({ directory: "/review" }) }, listen: () => () => {} },
    client: { rpc: () => ({ snapshot: async () => ({ accountKey: "a".repeat(64), slate: { endsAt: quest.endsAt, items }, records: [] }), detail: async ({ id }: { id: string }) => ({ ...items.find(q => q.id === id), latestSubmission: null }) }) },
    keymap: { layer: (value: typeof layer) => { layer = value; }, mode: { current: () => "base" } },
    ui: { router: { navigate: () => {} }, dialog: { clear: () => {} } },
  } as unknown as Context;
  const app = await testRender(() => <PluginContextProvider value={context}><DailyQuestsPage /></PluginContextProvider>, { width, height });
  const settle = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); await app.renderOnce(); } };
  const key = (bind: string) => layer().commands.find(c => c.bind === bind)!.run();
  try {
    await settle();
    key("down"); key("down"); await settle();
    const selected = app.renderer.root.findDescendantById("daily-quest-third")!;
    const find = (node: Renderable): ScrollBoxRenderable | undefined => node instanceof ScrollBoxRenderable ? node : node.getChildren().map(find).find(Boolean);
    const scroll = find(app.renderer.root)!;
    expect(selected.y).toBeGreaterThanOrEqual(scroll.viewport.y);
    expect(selected.y + selected.height).toBeLessThanOrEqual(scroll.viewport.y + scroll.viewport.height);
    expect(app.captureCharFrame()).toContain("› Resolve a review finding");
    key("return"); await settle();
    expect(app.captureCharFrame()).toContain("Choose completed work");
    key("escape"); await settle();
    expect(app.captureCharFrame()).toContain("Completed (0)");
  } finally { app.renderer.destroy(); }
});
