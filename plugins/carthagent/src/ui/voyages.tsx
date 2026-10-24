/** @jsxImportSource @opentui/solid */
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import type { ScrollBoxRenderable } from "@opentui/core";
import { usePlugin } from "@opencode/plugin/tui";
import { voyagesClient, type VoyagesSnapshot, type VoyagesProfile, type VoyagesItem, type VoyagesQuote } from "./client.js";
import { canEquip, createVoyagesState, handleVoyagesEvent, voyagesCatalogLabel } from "./voyages-state.mjs";

type ViewState = { snapshot?: VoyagesSnapshot; busy: boolean; error: string; notice: string };

/** All mutations go through the lifetime-guarded controller, including dialogs. */
export function VoyagesPage(props: { sessionID?: string }) {
  const context = usePlugin();
  const location = () => (props.sessionID ? context.data.session.get(props.sessionID)?.location : undefined) ?? context.location ?? context.data.location.default();
  const [view, setView] = createSignal<ViewState>({ busy: false, error: "", notice: "" });
  const controller = createVoyagesState({ api: voyagesClient(context, location), changed: (next: ViewState) => setView(next) });
  const back = () => context.ui.router.navigate(props.sessionID ? { type: "session", sessionID: props.sessionID } : { type: "home" });
  let summary: ScrollBoxRenderable | undefined;
  context.keymap.layer(() => ({
    commands: [
      { bind: "ctrl+u", title: "Scroll Voyages profile up", run: () => { summary?.scrollBy(-1); } },
      { bind: "ctrl+d", title: "Scroll Voyages profile down", run: () => { summary?.scrollBy(1); } },
    ],
  }));
  let activeDialog: symbol | undefined;
  const ownDialog = async <T,>(show: () => Promise<T>): Promise<T> => {
    const token = Symbol();
    activeDialog = token;
    try { return await show(); }
    finally { if (activeDialog === token) activeDialog = undefined; }
  };
  const closeOwnDialog = () => {
    if (!activeDialog) return;
    activeDialog = undefined;
    context.ui.dialog.clear();
  };
  const confirm = (title: string, message: string, label = "Confirm") => ownDialog(() => context.ui.dialog.confirm({ title, message, label: { confirm: label, cancel: "Cancel" } }));
  const customize = () => controller.customize(async (profile: VoyagesProfile, live: () => boolean) => {
    const name = await ownDialog(() => context.ui.dialog.prompt({ title: "Preview captain name (1–20 characters)", placeholder: profile.name }));
    if (name == null || !live()) return;
    const shipName = await ownDialog(() => context.ui.dialog.prompt({ title: "Preview ship name (1–28 characters)", placeholder: profile.shipName }));
    if (shipName == null || !live()) return;
    // Empty input retains the current value. No inferred appearance choices.
    const patch = { name: name.trim() || profile.name, shipName: shipName.trim() || profile.shipName };
    if (patch.name.length > 20 || patch.shipName.length > 28) throw new Error("invalid name");
    return patch;
  }, (profile: VoyagesProfile, patch: { name: string; shipName: string }) => confirm("Save customization preview?", `Captain: ${profile.name} → ${patch.name}\nShip: ${profile.shipName} → ${patch.shipName}\nAppearance unchanged. Version ${profile.version}.\nOnly Save writes to your live profile.`, "Save"));
  const equip = (item: VoyagesItem) => controller.equip(item, (profile: VoyagesProfile) => confirm("Save equipment?", `${item.slot}: ${String(profile.config[item.slot] ?? "not reported")} → ${item.itemKey}\n${item.name} (${item.item})\nThis replaces the equipped slot. A catalog “none” choice unequips; no fabricated empty key is sent.`, "Equip"));
  const purchase = (item: VoyagesItem) => controller.purchase(item, (quote: VoyagesQuote, profile: VoyagesProfile) => confirm("Confirm live purchase?", `${item.name} (${quote.item})\nExact price: ${quote.price} coins\nCurrent wallet: ${profile.coins} coins\nAvailable: ${item.available}; eligible: ${item.eligible}${item.reason ? ` · ${item.reason}` : ""}\nQuote expires: ${quote.expiresAt}\nConfirm only before expiry. Cancel never purchases.`, "Purchase"));
  const retry = () => controller.retry((pending: NonNullable<VoyagesSnapshot["pending"]>) => confirm("Resolve pending purchase?", `Outcome unknown: ${pending.item}\n${pending.price} coins · quote ${pending.quoteId}\nReplay the server's SAME saved quote/key pair only. This does not create a new purchase key. Cancel keeps it pending.`, "Retry same purchase"));
  const chooseItem = async (item: VoyagesItem) => {
    if (view().busy) return;
    if (view().snapshot && canEquip(view().snapshot, item)) await equip(item);
    else await purchase(item);
  };
  type Action = { name: string; description: string; value: string };
  const options = (): Action[] => {
    const snapshot = view().snapshot;
    const basic = [
      { name: "Refresh authoritative state", description: "Reload live profile and catalog", value: "refresh" },
      { name: "Sign in / reconnect", description: "Native provider connection · choose Carthagent Ship device sign-in", value: "signin" },
      { name: "Back", description: props.sessionID ? "Return to selected session" : "Return home", value: "back" },
    ];
    if (!snapshot) return basic;
    return [...basic,
      { name: "Customize captain and ship", description: "Preview names, then explicitly Save", value: "customize" },
      ...(snapshot.pending ? [{ name: "Resolve pending purchase", description: "Explicit same-pair replay; no automatic new charge", value: "retry" }] : []),
      ...snapshot.items.map((item) => ({ name: voyagesCatalogLabel(snapshot, item), description: `${item.slot} · ${item.itemKey} · ${!item.available ? "unavailable" : !item.eligible ? "ineligible" : canEquip(snapshot, item) ? "confirm equip" : item.price === null ? "purchase unavailable" : "request quote"}${item.reason ? ` · ${item.reason}` : ""}`, value: `item:${item.item}` })),
    ];
  };
  const select = (value?: string) => {
    if (!value || view().busy) return;
    if (value === "back") { back(); return; }
    if (value === "signin") {
      controller.invalidate();
      context.keymap.dispatch("provider.connect");
      return;
    }
    if (value === "refresh") { void controller.refresh(); return; }
    if (value === "customize") { void customize(); return; }
    if (value === "retry") { void retry(); return; }
    const item = view().snapshot?.items.find((entry) => `item:${entry.item}` === value);
    if (item) void chooseItem(item);
  };
  onMount(() => {
    let binding = JSON.stringify(location());
    const stop = context.data.listen(({ details }) => {
      const type = String(details.type);
      const changedLocation = binding !== JSON.stringify(location());
      if (changedLocation) {
        binding = JSON.stringify(location());
        controller.invalidate();
        closeOwnDialog();
        if (type !== "server.disconnected") void controller.refresh();
      } else void handleVoyagesEvent(controller, details, location(), closeOwnDialog);
    });
    void controller.refresh();
    onCleanup(() => { stop(); controller.dispose(); closeOwnDialog(); });
  });
  return <box flexDirection="column" flexGrow={1} padding={1}>
    <text flexShrink={0} fg={context.theme.text.action.primary.base}>CARTHAGENT · VOYAGES</text>
    {/* Split the remaining height: wrapped profile rows scroll instead of shrinking over one another. */}
    <scrollbox ref={summary} flexBasis={0} flexGrow={1} minHeight={1} contentOptions={{ flexDirection: "column" }}>
      <Show when={view().busy}><text flexShrink={0} fg={context.theme.text.feedback.warning.base}>Loading / awaiting confirmation… other actions are locked.</text></Show>
      <Show when={view().error}><text flexShrink={0} fg={context.theme.text.feedback.error.base}>{view().error}</text></Show>
      <Show when={view().notice}><text flexShrink={0} fg={context.theme.text.feedback.success.base}>{view().notice}</text></Show>
      <Show when={view().snapshot} fallback={<text flexShrink={0} fg={context.theme.text.muted}>Protected profile hidden until a successful refresh. Use Sign in for expired, revoked or legacy credentials.</text>}>{(snapshot) => <box flexDirection="column" flexShrink={0}>
        <text flexShrink={0} fg={context.theme.text.base}>{snapshot().profile.name} · ship {snapshot().profile.shipName} · version {snapshot().profile.version}</text>
        <text flexShrink={0} fg={context.theme.text.action.primary.base}>Wallet: {snapshot().profile.coins} coins · Level {snapshot().profile.level} · XP {snapshot().profile.totalXp} ({snapshot().profile.xpIntoLevel}/{snapshot().profile.xpForLevel})</text>
        <text flexShrink={0} fg={context.theme.text.muted}>Distance {snapshot().profile.km} km · weekly {snapshot().profile.weeklyKm} km</text>
        <text flexShrink={0} fg={context.theme.text.muted}>Skin {snapshot().profile.config.skin} · hair {snapshot().profile.config.hair} · pattern {snapshot().profile.config.pattern} · {snapshot().profile.owned.length} owned items</text>
        <text flexShrink={0} fg={context.theme.text.muted}>Equipped: hairStyle {snapshot().profile.config.hairStyle} · hat {snapshot().profile.config.hat} · shirt {snapshot().profile.config.shirt}</text>
        <text flexShrink={0} fg={context.theme.text.muted}>Bottoms {snapshot().profile.config.bottoms} · shoes {snapshot().profile.config.shoes} · pet {snapshot().profile.config.pet}</text>
        <text flexShrink={0} fg={context.theme.text.muted}>Hull {snapshot().profile.config.hull} · sail {snapshot().profile.config.sail} · setting {snapshot().profile.config.setting}</text>
        <Show when={snapshot().pending}><text flexShrink={0} fg={context.theme.text.feedback.warning.base}>Purchase pending / outcome unknown. Resolve the saved purchase explicitly; new purchases are blocked.</text></Show>
      </box>}</Show>
      <text flexShrink={0} fg={context.theme.text.muted}>Live profile · coins · owned equipment · shop. No coding rewards or grants.</text>
      <text flexShrink={0} fg={context.theme.text.faint}>Choose Back to return. Cancel in dialogs never saves or purchases.</text>
    </scrollbox>
    <text flexShrink={0} fg={context.theme.text.faint}>↑/↓ Enter · PgUp/Dn choices · Ctrl+U/D profile</text>
    <select flexBasis={0} flexGrow={1} flexShrink={0} minHeight={3} showScrollIndicator keyBindings={[{ name: "pageup", action: "move-up-fast" }, { name: "pagedown", action: "move-down-fast" }]} options={options()} focused={context.keymap.mode.current() === "base"} onSelect={(_index, option) => select(option?.value)} />
  </box>;
}
