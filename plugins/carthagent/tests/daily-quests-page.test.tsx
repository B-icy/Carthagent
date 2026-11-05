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

test("choosing recorded work discovers unvisited durable sessions across inventory pages", async () => {
  let layer: () => { commands: { bind: string; run: () => void }[] };
  const inventory: unknown[] = [], selected: unknown[] = [];
  const source = { runId: "22222222-2222-4222-8222-222222222222", revision: "a".repeat(64), planRevision: 1, freshness: "current", goal: "Handle a boundary", change: "Validate the input", checks: [], findings: [], truncated: false };
  const context = {
    theme: resolveThemeDocument(parseThemeDocument(theme), "dark"), location: { directory: "/review" },
    data: { session: { get: () => undefined, list: () => [] }, location: { default: () => ({ directory: "/review" }) }, listen: () => () => {} },
    client: {
      session: { list: async (input: { cursor?: string }) => {
        inventory.push(input);
        return input.cursor ? { data: [{ id: "durable", title: "Completed boundary fix", projectID: "project", location: { directory: "/review" } }], cursor: {} } : { data: [], cursor: { next: "page-two" } };
      } },
      rpc: () => ({ snapshot: async () => ({ accountKey: "a".repeat(64), slate: { endsAt: quest.endsAt, items: [quest] }, records: [] }), detail: async () => ({ ...quest, latestSubmission: null }), report: async () => ({ source }) }),
    },
    keymap: { layer: (value: typeof layer) => { layer = value; }, mode: { current: () => "base" } },
    ui: { router: { navigate: () => {} }, dialog: { clear: () => {}, select: async (input: unknown) => { selected.push(input); return "durable"; } } },
  } as unknown as Context;
  const app = await testRender(() => <PluginContextProvider value={context}><DailyQuestsPage questID={quest.id} /></PluginContextProvider>, { width: 110, height: 36 });
  const settle = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); await app.renderOnce(); } };
  try {
    await settle();
    layer().commands.find(c => c.bind === "return")!.run();
    await settle();
    expect(inventory).toEqual([{ directory: "/review", limit: 100, order: "desc" }, { directory: "/review", limit: 100, order: "desc", cursor: "page-two" }]);
    expect(selected).toEqual([{ title: "Choose completed work", options: [{ title: "Completed boundary fix", value: "durable", description: "Recorded Ship work" }] }]);
    expect(app.captureCharFrame()).toContain("Completed boundary fix");
    expect(app.captureCharFrame()).toContain("Submit");
  } finally { app.renderer.destroy(); }
});

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

const privacyWords = "Submit sends the selected summary, checks and findings to Carthagent and its external assessment provider (JEV). No transcript or whole project is uploaded. Review selected text for secrets before submitting. Project/outcome/run references stay with Carthagent. Assessment is not independent verification. Daily quests do not award coins or XP. Raw evidence: pending up to 24 hours, erased after processing; outages may delay cleanup. Metadata: 90 days. Provider policy applies; immediate provider/backup deletion is not promised. An interrupted send keeps an exact private local recovery copy for up to 24 hours, erased on acceptance or next journal access after expiry. Erase saved evidence removes that local copy, not a server job.";

function questContext({ account = () => "a".repeat(64), sessionID = false, sends = [] as string[] } = {}) {
  let layer: () => { commands: { bind: string; run: () => void }[] };
  let listener: ((event: { details: { type: string; data?: unknown } }) => void) | undefined;
  const source = { runId: "22222222-2222-4222-8222-222222222222", revision: "a".repeat(64), planRevision: 1, freshness: "current", goal: "Handle a boundary", change: "Validate the input", checks: [], findings: [], truncated: false };
  const context = {
    theme: resolveThemeDocument(parseThemeDocument(theme), "dark"), location: { directory: "/review" },
    data: { session: { get: () => ({ id: "ship", title: "Ship work", projectID: "p", location: { directory: "/review" } }), list: () => [{ id: "ship", title: "Ship work", projectID: "p", location: { directory: "/review" } }] }, location: { default: () => ({ directory: "/review" }) }, listen: (next: typeof listener) => { listener = next; return () => {}; } },
    client: { rpc: () => ({
      snapshot: async () => ({ accountKey: account(), slate: { endsAt: quest.endsAt, items: [quest] }, records: [] }),
      detail: async () => ({ ...quest, latestSubmission: null }), report: async () => ({ source }),
      submit: async () => { sends.push("submit"); throw new Error("must not submit"); },
    }) },
    keymap: { layer: (value: typeof layer) => { layer = value; }, mode: { current: () => "base" } },
    ui: { router: { navigate: () => {} }, dialog: { clear: () => {} } },
  } as unknown as Context;
  return { context, sessionID: sessionID ? "ship" : undefined, key: (bind: string) => layer().commands.find(c => c.bind === bind)!.run(), event: (type: string, data?: unknown) => listener?.({ details: { type, data } }) };
}
const actionsOf = (app: Awaited<ReturnType<typeof testRender>>) => { const find = (node: Renderable): SelectRenderable | undefined => node instanceof SelectRenderable ? node : node.getChildren().map(find).find(Boolean); return find(app.renderer.root)!; };

test("quest details wrap left of the scrollbar at 60x20 and keep the full privacy wording reachable", async () => {
  const q = questContext();
  const app = await testRender(() => <PluginContextProvider value={q.context}><DailyQuestsPage questID={quest.id} /></PluginContextProvider>, { width: 60, height: 20 });
  const settle = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); await app.renderOnce(); } };
  try {
    await settle();
    const list = actionsOf(app);
    list.setSelectedIndex(list.options.findIndex(o => o.value === "details")); list.selectCurrent();
    await settle();
    const find = (node: Renderable): ScrollBoxRenderable | undefined => node instanceof ScrollBoxRenderable ? node : node.getChildren().map(find).find(Boolean);
    const scroll = find(app.renderer.root)!;
    expect(scroll.verticalScrollBar.visible).toBe(true);
    const gutter = scroll.verticalScrollBar.x;
    let text = "";
    for (let step = 0; step < 40; step++) {
      const lines = app.captureCharFrame().split("\n").slice(scroll.viewport.y, scroll.viewport.y + scroll.viewport.height);
      for (const line of lines) expect(line.slice(scroll.viewport.x, gutter).length).toBe(gutter - scroll.viewport.x);
      // Nothing but the scrollbar may be drawn at or right of the gutter column.
      for (const line of lines) expect(line.slice(gutter + 1).trim()).toBe("");
      text += lines.map(line => line.slice(0, gutter)).join("\n") + "\n";
      scroll.scrollBy(1); await app.renderOnce();
    }
    const flattened = [...new Set(text.split("\n").map(l => l.trim()).filter(Boolean))].join(" ").replace(/\s+/g, " ");
    for (const sentence of privacyWords.split(/(?<=\.) /)) expect(flattened.replace(/ /g, "")).toContain(sentence.replace(/ /g, ""));
  } finally { app.renderer.destroy(); }
});

test("a quest opened from a Ship session previews work on the non-sending Details action, also after Details and back", async () => {
  const sends: string[] = [];
  const q = questContext({ sessionID: true, sends });
  const app = await testRender(() => <PluginContextProvider value={q.context}><DailyQuestsPage sessionID={q.sessionID} questID={quest.id} /></PluginContextProvider>, { width: 110, height: 36 });
  const settle = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); await app.renderOnce(); } };
  try {
    await settle();
    const list = actionsOf(app);
    expect(list.options[0].value).toBe("submit");
    expect(list.getSelectedOption()?.value).toBe("details");
    q.key("return"); await settle();
    expect(app.captureCharFrame()).toContain("Quest details");
    q.key("escape"); await settle();
    expect(actionsOf(app).getSelectedOption()?.value).toBe("details");
    q.key("up"); q.key("up"); q.key("up"); await settle();
    expect(actionsOf(app).getSelectedOption()?.value).toBe("submit");
    expect(sends).toEqual([]);
  } finally { app.renderer.destroy(); }
});

test("same-account refresh restores the open quest, preview and choice; activation stays off while it reconciles", async () => {
  const sends: string[] = [];
  const q = questContext({ sessionID: true, sends });
  const app = await testRender(() => <PluginContextProvider value={q.context}><DailyQuestsPage sessionID={q.sessionID} questID={quest.id} /></PluginContextProvider>, { width: 110, height: 36 });
  const settle = async () => { for (let i = 0; i < 16; i++) { await Promise.resolve(); await app.renderOnce(); } };
  try {
    await settle();
    q.key("down"); await settle();
    expect(actionsOf(app).getSelectedOption()?.value).toBe("back");
    q.event("credential.updated");
    // Synchronously cleared; Enter during reconciliation is disabled rather than redirected.
    await app.renderOnce();
    expect(app.captureCharFrame()).not.toContain("Ship work");
    await settle();
    expect(app.captureCharFrame()).toContain("Improve a behavior");
    expect(app.captureCharFrame()).toContain("Ship work");
    expect(actionsOf(app).options[0].value).toBe("submit");
    expect(actionsOf(app).getSelectedOption()?.value).toBe("back");
    expect(sends).toEqual([]);
  } finally { app.renderer.destroy(); }
});

test("an account change during refresh never restores the old quest, preview or Submit", async () => {
  let key = "a".repeat(64);
  const q = questContext({ sessionID: true, account: () => key });
  const app = await testRender(() => <PluginContextProvider value={q.context}><DailyQuestsPage sessionID={q.sessionID} questID={quest.id} /></PluginContextProvider>, { width: 110, height: 36 });
  const settle = async () => { for (let i = 0; i < 16; i++) { await Promise.resolve(); await app.renderOnce(); } };
  try {
    await settle();
    expect(app.captureCharFrame()).toContain("Ship work");
    key = "b".repeat(64);
    q.event("credential.switched", { integrationID: "experiential-labs" });
    await app.renderOnce();
    expect(app.captureCharFrame()).not.toContain("Ship work");
    await settle();
    const frame = app.captureCharFrame();
    expect(frame).not.toContain("Ship work");
    expect(frame).not.toContain("Submit shares this work");
    expect(frame).toContain("Quests");
  } finally { app.renderer.destroy(); }
});
