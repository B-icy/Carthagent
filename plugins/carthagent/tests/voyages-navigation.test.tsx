/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { ScrollBoxRenderable, SelectRenderable, type Renderable } from "@opentui/core";
import { createSignal } from "solid-js";
import { PluginContextProvider } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import { parseThemeDocument, resolveThemeDocument } from "@opencode/theme/tui";
import theme from "../themes/carthage.json";
import { Voyages } from "../src/voyages-rpc.js";
import { VoyagesNavigation } from "../src/ui/voyages-navigation.js";

const profile = { profile: { name: "Test captain", shipName: "Test vessel", coins: 10, level: 2, totalXp: 150 } };
const slate = { slate: { day: "2026-10-30", endsAt: "2026-10-31T00:00:00Z", items: [
  { id: "quest-one", definition: { title: "Protect a boundary" }, status: "open" },
  { id: "quest-two", definition: { title: "Review a change" }, status: "assessed_complete" },
] }, records: [{ request: { evidence: "must not appear in navigation", consent: true } }] };

async function fixture({ width = 30, height = 36, authenticated = true } = {}) {
  const [active, setActive] = createSignal(true);
  const [focused, setFocused] = createSignal(false);
  const [compact, setCompact] = createSignal(false);
  const [mode, setMode] = createSignal("base");
  const [sessionID, setSessionID] = createSignal<string | undefined>("coding-session");
  const routes: unknown[] = [], calls: string[] = [], selected: string[] = [];
  const responses: Promise<unknown>[] = [];
  let responseGate: Promise<void> | undefined;
  let listener: ((event: { details: { type: string } }) => void) | undefined;
  let listening = true;
  const context = {
    theme: resolveThemeDocument(parseThemeDocument(theme), "dark"),
    location: { directory: "/test-project" },
    data: {
      session: { get: () => ({ location: { directory: "/test-project" } }) },
      location: { default: () => ({ directory: "/test-project" }) },
      listen: (next: typeof listener) => { listener = next; return () => { listening = false; }; },
    },
    client: { rpc: (definition: unknown) => ({ snapshot: () => {
      calls.push(definition === Voyages ? "profile" : "daily");
      const response = authenticated ? (responseGate ?? Promise.resolve()).then(() => definition === Voyages ? profile : slate) : Promise.reject({ type: "voyagesError", data: { code: "authentication_required" } });
      responses.push(response);
      return response;
    } }) },
    keymap: { mode: { current: mode }, dispatch: (id: string) => { calls.push(id); } },
    ui: {
      router: { navigate: (route: unknown) => routes.push(route) },
      navigation: { current: () => "voyages", select: (name: string) => { selected.push(name); return true; } },
    },
  } as unknown as Context;
  const app = await testRender(() => <PluginContextProvider value={context}>
    <box width={width} height={height} visible={active()}>
      <VoyagesNavigation width={width} active={active()} compact={compact()} focused={focused()} sessionID={sessionID()} focus={() => { if (mode() !== "base") return; setFocused(true); setMode("navigation"); }} blur={() => { setFocused(false); if (mode() === "navigation") setMode("base"); }} />
    </box>
  </PluginContextProvider>, { width, height, kittyKeyboard: true });
  const settle = async () => { await Promise.allSettled(responses); await app.renderOnce(); };
  await settle();
  return {
    app, calls, routes, selected, mode, setMode, setActive, setFocused, setCompact, setSessionID, settle,
    focus: async () => { setFocused(true); setMode("navigation"); await app.renderOnce(); },
    event: (type: string) => listener?.({ details: { type } }),
    delay: (promise: Promise<void> | undefined) => { responseGate = promise; },
    listening: () => listening,
    list: () => app.renderer.currentFocusedRenderable as SelectRenderable,
    scroll: () => {
      const find = (node: Renderable): ScrollBoxRenderable | undefined => node instanceof ScrollBoxRenderable ? node : node.getChildren().map(find).find(Boolean);
      return find(app.renderer.root)!;
    },
  };
}

test.each([30, 18])("real Voyages navigator renders account and assignment summaries at width %i", async (width) => {
  const f = await fixture({ width });
  try {
    const frame = f.app.captureCharFrame();
    expect(frame).toContain("Test captain");
    expect(frame).toContain("10 coins");
    expect(frame).toContain("Daily coding");
    expect(frame).not.toContain("must not appear");
    expect(f.calls).toEqual(["profile", "daily"]);
    expect(f.routes).toHaveLength(0);
  } finally { f.app.renderer.destroy(); }
  expect(f.listening()).toBe(false);
});

test("rail focus owns arrows/Enter; palette or modal mode cannot trigger a route", async () => {
  const f = await fixture();
  try {
    expect(f.app.renderer.currentFocusedRenderable).not.toBeInstanceOf(SelectRenderable);
    await f.focus();
    expect(f.list()).toBeInstanceOf(SelectRenderable);
    f.app.mockInput.pressArrow("down");
    await f.app.renderOnce();
    expect(f.list().getSelectedOption()?.value).toBe("quest:quest-one");
    for (const mode of ["modal", "palette", "base"]) {
      f.setMode(mode);
      await f.app.renderOnce();
      f.app.mockInput.pressEnter();
      await f.app.renderOnce();
      expect(f.routes).toHaveLength(0);
    }
    f.setMode("navigation");
    await f.app.renderOnce();
    f.app.mockInput.pressEnter();
    await f.app.renderOnce();
    expect(f.routes).toEqual([{ type: "plugin", name: "daily-quests", data: { sessionID: "coding-session", questID: "quest-one" } }]);
    expect(f.mode()).toBe("base");
    expect(f.calls).toEqual(["profile", "daily"]);
  } finally { f.app.renderer.destroy(); }
});

test("Projects/Voyages toggles retain selection and do not route, submit or purchase", async () => {
  const f = await fixture();
  try {
    await f.focus();
    f.app.mockInput.pressArrow("down");
    await f.app.renderOnce();
    expect(f.list().getSelectedOption()?.value).toBe("quest:quest-one");
    f.setActive(false);
    await f.settle();
    expect(f.app.captureCharFrame()).not.toContain("Test captain");
    f.setActive(true);
    await f.settle();
    expect(f.list().getSelectedOption()?.value).toBe("quest:quest-one");
    expect(f.routes).toHaveLength(0);
    expect(f.calls).toEqual(["profile", "daily", "profile", "daily"]);
  } finally { f.app.renderer.destroy(); }
});

test("compact mode uses the same mounted selection and keyboard behavior", async () => {
  const f = await fixture();
  try {
    await f.focus();
    f.app.mockInput.pressArrow("down");
    await f.app.renderOnce();
    const list = f.list();
    f.setCompact(true);
    f.app.resize(5, 36);
    await f.app.renderOnce();
    expect(f.list()).toBe(list);
    expect(f.list().getSelectedOption()?.value).toBe("quest:quest-one");
    expect(f.app.captureCharFrame()).not.toContain("Test captain");
    f.app.mockInput.pressEnter();
    await f.app.renderOnce();
    expect(f.routes).toEqual([{ type: "plugin", name: "daily-quests", data: { sessionID: "coding-session", questID: "quest-one" } }]);
  } finally { f.app.renderer.destroy(); }
});

test("switching modes preserves the Voyages scroll position at a short terminal height", async () => {
  const f = await fixture({ height: 12 });
  try {
    const scroll = f.scroll();
    scroll.scrollBy(5);
    await f.app.renderOnce();
    const before = scroll.scrollTop;
    expect(before).toBeGreaterThan(0);
    f.setActive(false);
    await f.settle();
    f.setActive(true);
    await f.settle();
    expect(f.scroll()).toBe(scroll);
    expect(scroll.scrollTop).toBe(before);
    expect(f.routes).toHaveLength(0);
  } finally { f.app.renderer.destroy(); }
});

test("slow summary reads preserve scrolled position after an intervening loading layout", async () => {
  const f = await fixture({ height: 12 });
  try {
    const scroll = f.scroll();
    scroll.scrollTo(100);
    await f.app.renderOnce();
    const before = scroll.scrollTop;
    expect(before).toBeGreaterThan(0);
    f.setActive(false);
    await f.app.renderOnce();
    const gate = Promise.withResolvers<void>();
    f.delay(gate.promise);
    f.setActive(true);
    await f.app.renderOnce();
    expect(f.app.captureCharFrame()).not.toContain("Test captain");
    expect(f.calls).toEqual(["profile", "daily", "profile", "daily"]);
    gate.resolve();
    await f.settle();
    await f.app.renderOnce();
    expect(scroll.scrollTop).toBe(before);
  } finally { f.app.renderer.destroy(); }
});

test("short terminal keyboard navigation keeps the highlighted action on screen", async () => {
  const f = await fixture({ height: 12 });
  try {
    await f.focus();
    for (let index = 0; index < 7; index++) {
      f.app.mockInput.pressArrow("down");
      await f.app.renderOnce();
    }
    expect(f.list().getSelectedOption()?.value).toBe("back");
    expect(f.app.captureCharFrame()).toContain("Return to coding");
    expect(f.list().height).toBeLessThanOrEqual(f.scroll().viewport.height);
    expect(f.routes).toHaveLength(0);
  } finally { f.app.renderer.destroy(); }
});

test("mouse focus enters navigation only from base mode and never acts through an open modal", async () => {
  const f = await fixture();
  try {
    const row = f.app.captureCharFrame().split("\n").findIndex((line) => line.includes("Daily coding quests"));
    expect(row).toBeGreaterThanOrEqual(0);
    f.setMode("modal");
    await f.app.renderOnce();
    await f.app.mockMouse.click(5, row);
    await f.app.renderOnce();
    expect(f.mode()).toBe("modal");
    expect(f.routes).toHaveLength(0);
    f.setMode("base");
    f.app.renderer.clearSelection();
    await f.app.renderOnce();
    await f.app.mockMouse.click(5, row);
    await f.app.renderOnce();
    expect(f.mode()).toBe("navigation");
    expect(f.app.renderer.currentFocusedRenderable).toBeInstanceOf(SelectRenderable);
    expect(f.routes).toHaveLength(0);
    f.app.mockInput.pressEnter();
    await f.app.renderOnce();
    expect(f.routes).toEqual([{ type: "plugin", name: "daily-quests", data: { sessionID: "coding-session" } }]);
  } finally { f.app.renderer.destroy(); }
});

test("signed-out account and invalidation hide protected summaries, reset stale selection, and stay read-only", async () => {
  const f = await fixture({ authenticated: false });
  try {
    expect(f.app.captureCharFrame()).toContain("authentication_required");
    expect(f.app.captureCharFrame()).not.toContain("Test captain");
    await f.focus();
    f.app.mockInput.pressArrow("down");
    await f.app.renderOnce();
    f.event("credential.updated");
    await f.settle();
    expect(f.list().getSelectedOption()?.value).toBe("daily");
    expect(f.routes).toHaveLength(0);
    expect(f.calls).toEqual(["profile", "daily", "profile", "daily"]);
  } finally { f.app.renderer.destroy(); }
});

test.each(["coding-session", undefined])("return to coding explicitly navigates to the selected session or Home (%s)", async (sessionID) => {
  const f = await fixture();
  try {
    f.setSessionID(sessionID);
    await f.focus();
    const list = f.list();
    const index = list.options.findIndex((option) => option.value === "back");
    list.setSelectedIndex(index);
    f.app.mockInput.pressEnter();
    await f.app.renderOnce();
    expect(f.selected).toEqual(["projects"]);
    expect(f.routes).toEqual([sessionID ? { type: "session", sessionID } : { type: "home" }]);
  } finally { f.app.renderer.destroy(); }
});
