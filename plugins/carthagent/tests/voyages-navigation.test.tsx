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

async function fixture({ width = 30, height = 36, authenticated = true, hint = false } = {}) {
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
    <box width={width} height={height} visible={active()} flexDirection="column">
      {/* The native rail inserts this focus hint above the pane when it takes focus, like the pinned host. */}
      {hint && focused() ? <text height={1} flexShrink={0}> ↑↓ Enter · Esc back</text> : null}
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
    expect(frame).not.toContain("Test captain");
    expect(frame).toContain("10 coins");
    expect(frame).toContain("Quests");
    expect(frame).toContain("Friends · WIP");
    expect(frame).not.toContain("Review a change");
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
    expect(f.list().getSelectedOption()?.value).toBe("equipment");
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
    expect(f.routes).toEqual([{ type: "plugin", name: "voyages", data: { sessionID: "coding-session", section: "equipment" } }]);
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
    expect(f.list().getSelectedOption()?.value).toBe("equipment");
    f.setActive(false);
    await f.settle();
    expect(f.app.captureCharFrame()).not.toContain("Test captain");
    f.setActive(true);
    await f.settle();
    expect(f.list().getSelectedOption()?.value).toBe("equipment");
    expect(f.routes).toHaveLength(0);
    expect(f.calls).toEqual(["profile", "daily", "profile", "daily"]);
  } finally { f.app.renderer.destroy(); }
});

test("server reconnect preserves the selected static rail destination without navigating", async () => {
  const f = await fixture();
  try {
    await f.focus();
    f.app.mockInput.pressArrow("down");
    await f.app.renderOnce();
    expect(f.list().getSelectedOption()?.value).toBe("equipment");
    f.event("server.connected");
    await f.settle();
    expect(f.list().getSelectedOption()?.value).toBe("equipment");
    expect(f.routes).toHaveLength(0);
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
    f.app.resize(11, 36);
    await f.app.renderOnce();
    expect(f.list()).toBe(list);
    expect(f.list().getSelectedOption()?.value).toBe("equipment");
    expect(f.app.captureCharFrame()).not.toContain("Test captain");
    f.app.mockInput.pressEnter();
    await f.app.renderOnce();
    expect(f.routes).toEqual([{ type: "plugin", name: "voyages", data: { sessionID: "coding-session", section: "equipment" } }]);
  } finally { f.app.renderer.destroy(); }
});

test("switching modes preserves the Voyages scroll position at a short terminal height", async () => {
  const f = await fixture({ height: 6 });
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
  const f = await fixture({ height: 6 });
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
    for (let index = 0; index < 3; index++) {
      f.app.mockInput.pressArrow("down");
      await f.app.renderOnce();
    }
    expect(f.list().getSelectedOption()?.value).toBe("back");
    expect(f.app.captureCharFrame()).toContain("Coding");
    expect(f.list().height).toBeLessThanOrEqual(f.scroll().viewport.height);
    expect(f.routes).toHaveLength(0);
  } finally { f.app.renderer.destroy(); }
});

test("mouse press focuses the rail and release opens the clicked row without acting through a modal", async () => {
  const f = await fixture();
  try {
    const row = f.app.captureCharFrame().split("\n").findIndex((line) => line.includes("Quests"));
    expect(row).toBeGreaterThanOrEqual(0);
    for (const mode of ["modal", "palette"]) {
      f.setMode(mode);
      await f.app.renderOnce();
      await f.app.mockMouse.click(5, row);
      await f.app.renderOnce();
      expect(f.mode()).toBe(mode);
      expect(f.routes).toHaveLength(0);
    }
    f.setMode("base");
    f.app.renderer.clearSelection();
    await f.app.renderOnce();
    await f.app.mockMouse.pressDown(5, row);
    await f.app.renderOnce();
    expect(f.mode()).toBe("navigation");
    expect(f.app.renderer.currentFocusedRenderable).toBeInstanceOf(SelectRenderable);
    expect(f.routes).toHaveLength(0);
    await f.app.mockMouse.release(5, row);
    await f.app.renderOnce();
    expect(f.routes).toEqual([{ type: "plugin", name: "daily-quests", data: { sessionID: "coding-session" } }]);
    expect(f.mode()).toBe("base");
    const friendsRow = f.app.captureCharFrame().split("\n").findIndex((line) => line.includes("Friends · WIP"));
    expect(friendsRow).toBeGreaterThanOrEqual(0);
    await f.app.mockMouse.click(5, friendsRow);
    await f.app.renderOnce();
    expect(f.routes).toEqual([
      { type: "plugin", name: "daily-quests", data: { sessionID: "coding-session" } },
    ]);
  } finally { f.app.renderer.destroy(); }
});

test("signed-out account and invalidation hide protected summaries, reset stale selection, and stay read-only", async () => {
  const f = await fixture({ authenticated: false });
  try {
    expect(f.app.captureCharFrame()).toContain("Sign in to load your voyages");
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

const rowOf = (frame: string, label: string) => frame.split("\n").findIndex((line) => {
  const text = line.replace(/[█▀▄]/g, "").trim().replace(/^▶ /, "");
  return text.length >= 3 && (text === label || (text.endsWith("…") && label.startsWith(text.slice(0, -1))));
});
const pointerCases = [
  { name: "unfocused full", width: 30, height: 36, compact: false, focused: false, scrolled: false },
  { name: "focused full", width: 30, height: 36, compact: false, focused: true, scrolled: false },
  { name: "unfocused compact", width: 11, height: 36, compact: true, focused: false, scrolled: false },
  { name: "focused compact", width: 11, height: 36, compact: true, focused: true, scrolled: false },
  { name: "unfocused scrolled", width: 30, height: 7, compact: false, focused: false, scrolled: true },
  { name: "focused scrolled", width: 30, height: 7, compact: false, focused: true, scrolled: true },
];
for (const c of pointerCases) for (const [label, route] of [["Shop", { type: "plugin", name: "voyages", data: { sessionID: "coding-session", section: "equipment" } }], [c.compact ? "Captain" : "Character", { type: "plugin", name: "voyages", data: { sessionID: "coding-session", section: "profile" } }]] as const) {
  test(`pointer activates the row under the press when the focus hint shifts the rail (${c.name}, ${label})`, async () => {
    const f = await fixture({ width: c.width, height: c.height, hint: true });
    try {
      if (c.compact) { f.setCompact(true); await f.app.renderOnce(); }
      if (c.focused) await f.focus();
      if (c.scrolled) { f.scroll().scrollBy(2); await f.app.renderOnce(); expect(f.scroll().scrollTop).toBeGreaterThan(0); }
      const frame = f.app.captureCharFrame();
      const row = rowOf(frame, label);
      if (row < 0) throw new Error(`${label} not drawn:\n${frame}`);
      await f.app.mockMouse.pressDown(3, row);
      await f.app.renderOnce();
      expect(f.mode()).toBe("navigation");
      expect(f.routes).toHaveLength(0);
      await f.app.mockMouse.release(3, row);
      await f.app.renderOnce();
      expect(f.routes).toEqual([route]);
    } finally { f.app.renderer.destroy(); }
  });
}

test("a release without a matching press, or on another row, never activates a rail row", async () => {
  const f = await fixture({ hint: true });
  try {
    await f.focus();
    const shop = rowOf(f.app.captureCharFrame(), "Shop");
    await f.app.mockMouse.release(3, shop);
    await f.app.renderOnce();
    expect(f.routes).toHaveLength(0);
    await f.app.mockMouse.pressDown(3, shop);
    await f.app.mockMouse.release(3, shop + 1);
    await f.app.renderOnce();
    expect(f.routes).toHaveLength(0);
    for (const button of [1, 2] as const) { await f.app.mockMouse.click(3, shop, button); await f.app.renderOnce(); }
    expect(f.routes).toHaveLength(0);
  } finally { f.app.renderer.destroy(); }
});
