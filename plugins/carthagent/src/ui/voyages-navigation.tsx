/** @jsxImportSource @opentui/solid */
import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { CliRenderEvents, TextAttributes, type ScrollBoxRenderable, type SelectRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { usePlugin } from "@opencode/plugin/tui";
import stringWidth from "string-width";
import { clickSelect } from "./select-mouse.js";
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
  let savedScroll = false;
  let restoreTop: number | undefined;
  const [viewportHeight, setViewportHeight] = createSignal(Math.max(1, renderer.height - 1));
  const [railWidth, setRailWidth] = createSignal(0);
  const [frame, setFrame] = createSignal(0);
  createEffect(() => {
    if (!props.active || !view().busy || process.env.CTG_REDUCED_MOTION === "1") return;
    const timer = setInterval(() => setFrame((value) => (value + 1) % 4), 120);
    onCleanup(() => clearInterval(timer));
  });
  createEffect(() => {
    if (!props.active) { scrollTop = scroll?.scrollTop ?? scrollTop; savedScroll = true; return; }
    if (!view().busy && savedScroll) { restoreTop = scrollTop; renderer.requestRender(); }
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
      if (actions && !actions.isDestroyed) setRailWidth(actions.width);
      if (restoreTop === undefined || view().busy) return;
      scroll.scrollTop = restoreTop;
      restoreTop = undefined;
      savedScroll = false;
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
  // Select draws raw text; fit names and descriptions to the rail.
  const fit = (text: string) => {
    const room = Math.max(1, (railWidth() || props.width) - 4);
    if (stringWidth(text) <= room) return text;
    let result = "";
    for (const { segment } of new Intl.Segmenter().segment(text)) {
      if (stringWidth(result + segment) > room - 1) break;
      result += segment;
    }
    return `${result}…`;
  };
  const errorLabel = () => /auth|credential|unauthorized/.test(view().error) ? "Sign in to load your voyages" : /timeout/.test(view().error) ? "Connection timed out · Refresh to retry" : "Could not load voyages · Refresh to retry";
   const options = () => entries().map((item) => ({ ...item, name: fit(item.name), description: fit(item.description) }));
  const entries = () => [
    { name: "Quests", description: "", value: "daily" },
    { name: "Shop", description: "", value: "equipment" },
    { name: props.compact ? "Captain" : "Character", description: "", value: "profile" },
    ...(view().error ? [{ name: "Refresh", description: "", value: "refresh" }] : []),
    ...(!view().profile ? [{ name: "Sign in", description: "Connect Carthagent Cloud", value: "signin" }] : []),
    { name: "Coding", description: "", value: "back" },
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
    if (value === "daily") open("daily-quests");
  };
  const focused = () => props.active && props.focused && context.keymap.mode.current() === "navigation";
  return <box flexDirection="column" flexGrow={1} minHeight={0} onMouseDown={() => { if (props.active && context.keymap.mode.current() === "base") props.focus(); }}>
    <scrollbox ref={scroll} flexGrow={1} minHeight={0} contentOptions={{ flexDirection: "column" }}>
      <Show when={props.compact && view().profile}><text paddingX={1} paddingY={1} flexShrink={0} fg={context.theme.text.base}>{view().profile!.coins} coins</text></Show>
      <Show when={!props.compact}>
        <Show when={view().profile}>{(p) => <box flexDirection="column" flexShrink={0} paddingX={1} paddingTop={1} paddingBottom={1}>
           <text fg={context.theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" truncate>{p().coins} coins</text>
        </box>}</Show>
        <Show when={view().busy}><text flexShrink={0} fg={context.theme.text.muted}> {['|', '/', '-', '\\'][frame()]} Loading voyages…</text></Show>
        <Show when={view().error}><box paddingX={1} paddingY={1} flexShrink={0}><text fg={context.theme.text.feedback.warning.base}>{errorLabel()}</text></box></Show>
      </Show>
      <select ref={actions} textColor={context.theme.text.base} descriptionColor={context.theme.text.muted} selectedTextColor={context.theme.text.base} selectedBackgroundColor={context.theme.background.raised.high} selectedDescriptionColor={context.theme.text.base} onMouseUp={(event) => { if (focused()) clickSelect(actions, event); }} minHeight={1} height={Math.min(viewportHeight(), options().length)} flexShrink={0} showScrollIndicator showDescription={false} options={options()} selectedIndex={Math.max(0, options().findIndex((item) => item.value === selection()))} focused={focused()} onChange={(_index, item) => {
        if (!focused() || view().busy || !item) return;
        setSelection(item.value);
        if (actions) scroll?.scrollChildIntoView(actions.id);
      }} onSelect={(_index, item) => select(item?.value)} />
      <box id="voyages-friends-locked" paddingX={1} paddingTop={1} flexShrink={0} flexDirection="column">
        <text fg={context.theme.text.action.secondary.disabled} selectable={false}>{props.compact ? "Friends" : "Friends · WIP"}</text>
        <Show when={props.compact}><text fg={context.theme.text.muted} selectable={false}>WIP</text></Show>
      </box>
    </scrollbox>
  </box>;
}
