/** @jsxImportSource @opentui/solid */
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { CliRenderEvents, type ScrollBoxRenderable, type SelectRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { usePlugin } from "@opencode/plugin/tui";
import { dailyQuestsClient, voyagesClient } from "./client.js";
import { nativeNavigation, type NavigationInput } from "./native-navigation.js";
import { createVoyagesNavigationState } from "./voyages-navigation-state.mjs";
import { voyagesEventAction } from "./voyages-state.mjs";

type Summary = {
  busy: boolean; error: string;
  profile?: { name: string; shipName: string; coins: number; level: number; totalXp: number };
  daily?: { day: string; endsAt: string; items: { id: string; title: string; status: string }[] };
};

export function VoyagesNavigation(props: NavigationInput) {
  const context = usePlugin();
  const renderer = useRenderer();
  const location = () => (props.sessionID ? context.data.session.get(props.sessionID)?.location : undefined) ?? context.location ?? context.data.location.default();
  const [view, setView] = createSignal<Summary>({ busy: false, error: "" });
  const [selection, setSelection] = createSignal("daily");
  const profile = voyagesClient(context, location), daily = dailyQuestsClient(context, location);
  const controller = createVoyagesNavigationState({ profile: profile.snapshot, daily: daily.snapshot, changed: setView });
  let actions: SelectRenderable | undefined;
  let scroll: ScrollBoxRenderable | undefined;
  let scrollTop = 0;
  let restoreTop: number | undefined;
  const [viewportHeight, setViewportHeight] = createSignal(3);
  createEffect(() => {
    if (!props.active) { scrollTop = scroll?.scrollTop ?? scrollTop; return; }
    if (!view().busy) { restoreTop = scrollTop; renderer.requestRender(); }
  });
  createEffect(() => { void controller.activate(props.active); });
  let binding = JSON.stringify(location());
  const resetSelection = () => { actions?.setSelectedIndex(0); setSelection("daily"); };
  createEffect(() => {
    const next = JSON.stringify(location());
    if (binding === next) return;
    binding = next;
    resetSelection();
    void controller.contextChanged();
  });
  onMount(() => {
    // FRAME follows layout. Earlier restoration clamps to the loading extent.
    const frame = () => {
      if (!scroll || scroll.isDestroyed || !props.active) return;
      setViewportHeight(Math.max(1, scroll.viewport.height));
      if (restoreTop === undefined || view().busy) return;
      scroll.scrollTop = restoreTop;
      restoreTop = undefined;
    };
    renderer.on(CliRenderEvents.FRAME, frame);
    onCleanup(() => renderer.off(CliRenderEvents.FRAME, frame));
    const stop = context.data.listen(({ details }) => {
      const changedLocation = binding !== JSON.stringify(location());
      binding = JSON.stringify(location());
      const action = changedLocation ? String(details.type) === "server.disconnected" ? "clear" : "refresh" : voyagesEventAction(details, location());
      if (action === "ignore") return;
      resetSelection();
      if (action === "clear") controller.disconnect();
      else void controller.contextChanged();
    });
    onCleanup(stop);
  });
  onCleanup(() => controller.dispose());
  const open = (name: "voyages" | "daily-quests", extra: Record<string, string> = {}) => {
    props.blur();
    if (nativeNavigation(context)?.current() !== "voyages") return;
    context.ui.router.navigate({ type: "plugin", name, data: { ...(props.sessionID ? { sessionID: props.sessionID } : {}), ...extra } });
  };
  const options = () => [
    { name: props.compact ? "Q" : "Daily coding quests", description: "Assignments & assessments", value: "daily" },
    ...(view().daily?.items.map((quest, index) => ({ name: props.compact ? String(index + 1) : quest.title, description: quest.status, value: `quest:${quest.id}` })) ?? []),
    { name: props.compact ? "P" : "Profile & wallet", description: "Authoritative profile", value: "profile" },
    { name: props.compact ? "E" : "Equipment & shop", description: "Preview before any purchase", value: "equipment" },
    { name: props.compact ? "R" : "Refresh summaries", description: "Read-only; no evidence upload", value: "refresh" },
    { name: props.compact ? "S" : "Sign in / reconnect", description: "Native Ship device sign-in", value: "signin" },
    { name: props.compact ? "B" : "Return to coding", description: "Keep the selected session", value: "back" },
  ];
  const select = (value?: string) => {
    if (!props.active || context.keymap.mode.current() !== "navigation" || !props.focused || !value) return;
    if (value === "refresh") { void controller.refresh(); return; }
    if (value === "signin") { controller.invalidate(); props.blur(); context.keymap.dispatch("provider.connect"); return; }
    if (value === "back") {
      props.blur();
      nativeNavigation(context)?.select("projects");
      context.ui.router.navigate(props.sessionID ? { type: "session", sessionID: props.sessionID } : { type: "home" });
      return;
    }
    if (value === "profile" || value === "equipment") { open("voyages", { section: value }); return; }
    open("daily-quests", value.startsWith("quest:") ? { questID: value.slice(6) } : {});
  };
  const focused = () => props.active && props.focused && context.keymap.mode.current() === "navigation";
  return <box flexDirection="column" flexGrow={1} minHeight={0} onMouseDown={() => { if (props.active && context.keymap.mode.current() === "base") props.focus(); }}>
    <scrollbox ref={scroll} flexGrow={1} minHeight={0} contentOptions={{ flexDirection: "column" }}>
      <Show when={!props.compact}>
        <Show when={view().profile}>{(p) => <box flexDirection="column" flexShrink={0} paddingX={1}>
          <text fg={context.theme.text.base}>{p().name}</text>
          <text fg={context.theme.text.muted}>{p().shipName}</text>
          <text fg={context.theme.text.action.primary.base}>Lv {p().level} · {p().coins} coins</text>
          <text fg={context.theme.text.muted}>XP {p().totalXp}</text>
        </box>}</Show>
        <Show when={view().busy}><text flexShrink={0} fg={context.theme.text.muted}> Loading summaries…</text></Show>
        <Show when={view().error}><text flexShrink={0} fg={context.theme.text.feedback.warning.base}> {view().error}. Sign in or refresh.</text></Show>
        <Show when={view().daily}><text flexShrink={0} fg={context.theme.text.muted}> UTC {view().daily?.day}</text></Show>
      </Show>
      <select ref={actions} minHeight={1} height={Math.min(18, viewportHeight(), options().length * (props.compact ? 1 : 2))} flexShrink={0} showScrollIndicator showDescription={!props.compact} options={options()} selectedIndex={Math.max(0, options().findIndex((item) => item.value === selection()))} focused={focused()} onChange={(_index, item) => {
        if (!focused() || view().busy || !item) return;
        setSelection(item.value);
        if (actions) scroll?.scrollChildIntoView(actions.id);
      }} onSelect={(_index, item) => select(item?.value)} />
      <Show when={!props.compact}>
        <text flexShrink={0} fg={context.theme.text.faint}> Badges & friends: no native views yet.</text>
        <text flexShrink={0} fg={context.theme.text.faint}> Quests: no rewards. No automatic uploads.</text>
      </Show>
    </scrollbox>
    <Show when={!props.compact}>
      <text flexShrink={0} fg={context.theme.text.faint}>{focused() ? " ↑/↓ Enter · Esc coding" : " Focus pane to navigate"}</text>
    </Show>
  </box>;
}
