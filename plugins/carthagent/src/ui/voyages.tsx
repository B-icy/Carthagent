/** @jsxImportSource @opentui/solid */
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { TextAttributes, type ScrollBoxRenderable, type SelectRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { clickSelect } from "./select-mouse.js";
import { usePlugin } from "@opencode/plugin/tui";
import { voyagesClient, type VoyagesSnapshot, type VoyagesProfile, type VoyagesItem, type VoyagesQuote } from "./client.js";
import { canEquip, createVoyagesState, handleVoyagesEvent, voyagesCatalogLabel } from "./voyages-state.mjs";
import { voyagesAppearance, voyagesSlots, type VoyagesSlot } from "../voyages-rpc.js";
import { VoyagesPreview } from "./voyages-preview.js";

type ViewState = { snapshot?: VoyagesSnapshot; busy: boolean; error: string; notice: string };

/** All mutations go through the lifetime-guarded controller, including dialogs. */
export function VoyagesPage(props: { sessionID?: string; section?: "profile" | "equipment" }) {
  let list: SelectRenderable | undefined;
  const context = usePlugin();
  const dimensions = useTerminalDimensions();
  const [category, setCategory] = createSignal<VoyagesSlot>();
  const [previewItem, setPreviewItem] = createSignal<VoyagesItem>();
  const [appearance, setAppearance] = createSignal<Partial<Record<"skin" | "hair" | "pattern", string>>>({});
  const labels: Record<VoyagesSlot, string> = { hairStyle: "Hairstyles", hat: "Hats", shirt: "Tops", bottoms: "Bottoms", shoes: "Shoes", pet: "Companions", hull: "Hulls", sail: "Sails", setting: "Harbours" };
  const location = () => (props.sessionID ? context.data.session.get(props.sessionID)?.location : undefined) ?? context.location ?? context.data.location.default();
  const [view, setView] = createSignal<ViewState>({ busy: false, error: "", notice: "" });
  const controller = createVoyagesState({ api: voyagesClient(context, location), changed: (next: ViewState) => setView(next) });
  const back = () => context.ui.router.navigate(props.sessionID ? { type: "session", sessionID: props.sessionID } : { type: "home" });
  const goBack = () => {
    if (previewItem()) { setPreviewItem(undefined); return; }
    if (category()) { setCategory(undefined); return; }
    back();
  };
  let summary: ScrollBoxRenderable | undefined;
  context.keymap.layer(() => ({
    priority: 30,
    commands: [
      { bind: "ctrl+u", title: "Scroll Voyages profile up", run: () => { summary?.scrollBy(-1); } },
      { bind: "ctrl+d", title: "Scroll Voyages profile down", run: () => { summary?.scrollBy(1); } },
      { bind: "escape", title: "Back", enabled: () => !view().busy && context.keymap.mode.current() === "base", run: goBack },
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
    const field = await ownDialog(() => context.ui.dialog.select({ title: "Customize your captain", options: [
      { title: "Captain name", value: "name" }, { title: "Ship name", value: "shipName" },
      { title: "Skin tone", value: "skin" }, { title: "Hair colour", value: "hair" }, { title: "Sail pattern", value: "pattern" },
    ] }));
    if (!field || !live()) return;
    if (field === "name" || field === "shipName") {
      const value = await ownDialog(() => context.ui.dialog.prompt({ title: field === "name" ? "Captain name · up to 20 characters" : "Ship name · up to 28 characters", value: profile[field] }));
      if (!value?.trim() || !live()) return;
      return { [field]: value.trim() };
    }
    const key = field as keyof typeof voyagesAppearance;
    const value = await ownDialog(() => context.ui.dialog.select({ title: key === "skin" ? "Skin tone" : key === "hair" ? "Hair colour" : "Sail pattern", options: voyagesAppearance[key].map(value => ({ title: value[0].toUpperCase() + value.slice(1), value })) }));
    if (!value || !live()) return;
    setAppearance({ [key]: value });
    return { [key]: value };
  }, (_profile: VoyagesProfile, patch: Record<string, string>) => confirm("Save customization?", Object.entries(patch).map(([key, value]) => `${key === "shipName" ? "Ship name" : key[0].toUpperCase() + key.slice(1)}: ${value}`).join("\n"), "Save")).finally(() => setAppearance({}));
  const equip = (item: VoyagesItem) => controller.equip(item, () => confirm("Equip this item?", `${item.name}\nReplaces your current ${labels[item.slot].toLowerCase()}.`, "Equip"));
  const purchase = (item: VoyagesItem) => controller.purchase(item, (quote: VoyagesQuote, profile: VoyagesProfile) => confirm("Buy this item?", `${item.name}\n${quote.price} coins · Balance after purchase: ${profile.coins - quote.price} coins`, "Buy"));
  const retry = () => controller.retry((pending: NonNullable<VoyagesSnapshot["pending"]>) => confirm("Resolve pending purchase?", `Outcome unknown: ${pending.item}\n${pending.price} coins · quote ${pending.quoteId}\nReplay the server's SAME saved quote/key pair only. This does not create a new purchase key. Cancel keeps it pending.`, "Retry same purchase"));
  const chooseItem = async (item: VoyagesItem) => {
    if (view().busy) return;
    if (view().snapshot && canEquip(view().snapshot, item)) await equip(item);
    else if (item.price !== null && item.price <= (view().snapshot?.profile.coins ?? 0)) await purchase(item);
  };
  type Action = { name: string; description: string; value: string };
  const options = (): Action[] => {
    const snapshot = view().snapshot;
    const item = previewItem();
    if (snapshot && item) return [
      ...(canEquip(snapshot, item) ? snapshot.profile.config[item.slot] === item.itemKey ? [] : [{ name: "Equip", description: "", value: "equip-preview" }] : item.available && item.eligible && item.price !== null && item.price <= snapshot.profile.coins ? [{ name: `Buy · ${item.price} coins`, description: "", value: "buy-preview" }] : []),
      { name: "Back to items", description: "", value: "back" },
    ];
    if (snapshot && props.section === "equipment") return category() ? [
      { name: "Back to categories", description: "", value: "back" },
      ...snapshot.items.filter(item => item.slot === category()).map(item => ({ name: voyagesCatalogLabel(snapshot, item), description: "", value: `item:${item.item}` })),
    ] : [
      ...voyagesSlots.map(slot => ({ name: labels[slot], description: "", value: `category:${slot}` })),
      { name: "Character", description: "", value: "section" },
      ...(snapshot.pending ? [{ name: "Resolve pending purchase", description: "", value: "retry" }] : []),
      { name: "Refresh", description: "", value: "refresh" },
    ];
    const basic = [
      ...(snapshot ? [{ name: "Customize", description: "", value: "customize" }, { name: "Shop", description: "", value: "section" }] : []),
      { name: "Quests", description: "", value: "daily" },
      { name: "Refresh", description: "Reload profile and shop", value: "refresh" },
      ...(!snapshot ? [{ name: "Sign in", description: "Connect Carthagent Cloud", value: "signin" }] : []),
      { name: "Back", description: props.sessionID ? "Return to selected session" : "Return home", value: "back" },
    ];
    if (!snapshot) return basic;
    return [...basic,
      ...(props.sessionID ? [{ name: "Claim verified delivery reward", description: "Preview this session’s eligible handoff, then claim once", value: "reward" }] : []),
      ...(snapshot.pending ? [{ name: "Resolve pending purchase", description: "Explicit same-pair replay; no automatic new charge", value: "retry" }] : []),
    ];
  };
  const select = (value?: string) => {
    if (!value || view().busy || context.keymap.mode.current() !== "base") return;
    if (value === "back") { goBack(); return; }
    if (value.startsWith("category:")) { setCategory(value.slice(9) as VoyagesSlot); list?.setSelectedIndex(0); return; }
    if (value === "equip-preview" || value === "buy-preview") { const item = previewItem(); if (item) void chooseItem(item); return; }
    if (value === "signin") {
      controller.invalidate();
      context.keymap.dispatch("provider.connect");
      return;
    }
    if (value === "refresh") { void controller.refresh(); return; }
    if (value === "reward" && props.sessionID) { void controller.claimReward(props.sessionID, (preview: { coins: number; xp: number; km: number; dailyLimit: number; runId: string; snapshot: string }) => confirm("Claim delivery reward?", `+${preview.coins} coins · +${preview.xp} XP · +${preview.km} km\nUp to ${preview.dailyLimit} deliveries per UTC day.\nRun: ${preview.runId}\nSnapshot: ${preview.snapshot}\nSends delivery/check/review digests, not code or output. Based on local harness verification; the server does not rerun your repository. Replaying this delivery never earns twice.`, "Claim")); return; }
    if (value === "section") { setCategory(undefined); setPreviewItem(undefined); context.ui.router.navigate({ type: "plugin", name: "voyages", data: { ...(props.sessionID ? { sessionID: props.sessionID } : {}), section: props.section === "equipment" ? "profile" : "equipment" } }); return; }
    if (value === "daily") { context.ui.router.navigate({ type: "plugin", name: "daily-quests", data: { ...(props.sessionID ? { sessionID: props.sessionID } : {}) } }); return; }
    if (value === "customize") { void customize(); return; }
    if (value === "retry") { void retry(); return; }
    const item = view().snapshot?.items.find((entry) => `item:${entry.item}` === value);
    if (item) { setPreviewItem(item); list?.setSelectedIndex(0); summary?.scrollTo(0); }
  };
  onMount(() => {
    let binding = JSON.stringify(location());
    const stop = context.data.listen(({ details }) => {
      const type = String(details.type);
      const changedLocation = binding !== JSON.stringify(location());
      if (changedLocation) {
        binding = JSON.stringify(location());
        controller.invalidate();
        setPreviewItem(undefined); setAppearance({});
        closeOwnDialog();
        if (type !== "server.disconnected") void controller.refresh();
      } else void handleVoyagesEvent(controller, details, location(), () => { setPreviewItem(undefined); setAppearance({}); closeOwnDialog(); });
    });
    void controller.refresh();
    onCleanup(() => { stop(); controller.dispose(); closeOwnDialog(); });
  });
  return <box flexDirection="column" flexGrow={1} minHeight={0} paddingX={2} paddingY={1} overflow="hidden" backgroundColor={context.theme.background.base}>
    <text flexShrink={0} fg={context.theme.text.base} attributes={TextAttributes.BOLD}>{previewItem()?.name ?? (props.section === "equipment" ? category() ? labels[category()!] : "Shop" : "Character")}</text>
    {/* Split the remaining height: wrapped profile rows scroll instead of shrinking over one another. */}
    <scrollbox ref={summary} flexBasis={0} flexGrow={1} minHeight={1} overflow="hidden" contentOptions={{ flexDirection: "column" }}>
      <Show when={view().busy}><text flexShrink={0} fg={context.theme.text.muted}>Loading…</text></Show>
      <Show when={view().error}><text flexShrink={0} fg={context.theme.text.feedback.error.base}>{view().error}</text></Show>
      <Show when={view().notice}><text flexShrink={0} fg={context.theme.text.feedback.success.base}>{view().notice}</text></Show>
      <Show when={view().snapshot} fallback={<text flexShrink={0} fg={context.theme.text.muted}>Sign in to see your captain, ship and wallet.</text>}>{(snapshot) => <box flexDirection="column" flexShrink={0}>
        <text flexShrink={0} fg={context.theme.text.muted}>{snapshot().profile.coins} coins · Level {snapshot().profile.level}</text>
        <VoyagesPreview background={context.theme.background.base} config={{ ...snapshot().profile.config, ...appearance(), ...(previewItem() ? { [previewItem()!.slot]: previewItem()!.itemKey } : {}) }} height={dimensions().height < 26 ? 7 : 13} />
        <text flexShrink={0} fg={context.theme.text.base} attributes={TextAttributes.BOLD}>{snapshot().profile.name} · {snapshot().profile.shipName}</text>
        <Show when={previewItem()} fallback={<>
          <text flexShrink={0} fg={context.theme.text.muted}>{snapshot().profile.xpIntoLevel} / {snapshot().profile.xpForLevel} XP to next level · {snapshot().profile.km} km sailed</text>
          <text flexShrink={0} fg={context.theme.text.muted}>Earn coins and XP with verified Ship deliveries.</text>
        </>}>{item => <>
          <text flexShrink={0} fg={context.theme.text.base}>{voyagesCatalogLabel(snapshot(), item())}</text>
          <text flexShrink={0} fg={context.theme.text.muted}>{snapshot().profile.config[item().slot] === item().itemKey ? "Currently equipped" : !item().available ? "Currently unavailable" : !item().eligible ? item().reason ?? "Unlock this item through your voyages" : item().price === null && !canEquip(snapshot(), item()) ? "Not available to buy" : !canEquip(snapshot(), item()) && item().price! > snapshot().profile.coins ? `Earn ${item().price! - snapshot().profile.coins} more coins to buy this item` : "Preview · choose Equip or Buy to save"}</text>
        </>}</Show>
        <Show when={snapshot().pending}><text flexShrink={0} fg={context.theme.text.feedback.warning.base}>Purchase pending / outcome unknown. Resolve the saved purchase explicitly; new purchases are blocked.</text></Show>
      </box>}</Show>
    </scrollbox>
    <select height={5} flexShrink={0} backgroundColor={context.theme.background.base} focusedBackgroundColor={context.theme.background.base} focusedTextColor={context.theme.text.action.secondary.base} textColor={context.theme.text.action.secondary.base} selectedTextColor={context.theme.text.formfield.focused} selectedBackgroundColor={context.theme.background.formfield.focused} showDescription={false} ref={(node) => { list = node; }} onMouseUp={(event) => clickSelect(list, event)} showScrollIndicator keyBindings={[{ name: "pageup", action: "move-up-fast" }, { name: "pagedown", action: "move-down-fast" }]} options={options()} focused={!view().busy && context.keymap.mode.current() === "base"} onSelect={(_index, option) => select(option?.value)} />
    <text flexShrink={0} fg={context.theme.text.muted}>↑↓ Enter select · Ctrl+U/D scroll · Esc back</text>
  </box>;
}
