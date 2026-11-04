/** @jsxImportSource @opentui/solid */
import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { createHash, randomUUID } from "node:crypto";
import { TextAttributes, type ScrollBoxRenderable, type SelectRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { usePlugin } from "@opencode/plugin/tui";
import { clickSelect } from "./select-mouse.js";
import { dailyQuestsClient, dailySourceClient } from "./client.js";
import type { DailyEvidence, DailyQuestDetail, DailySnapshot, DailyRecord } from "../daily-quests-rpc.js";
import { createDailyQuestsState } from "./daily-quests-state.mjs";
import { handleDailyQuestsEvent } from "./daily-quests-events.mjs";
import { selectedQuestEvidence } from "./quest-evidence.mjs";
import { assessmentFeedback, questConditions, questCopy, questReset, questStatus, submissionText } from "./quest-presentation.mjs";

type View = {
  snapshot?: DailySnapshot; detail?: DailyQuestDetail; busy: boolean; error: string;
  draft?: { accountKey: string; questId: string; id: string; text: string; provenance: string };
  preview?: NonNullable<DailyRecord["request"]>; phase: string;
};
function reference(...parts: string[]) {
  const h = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
const privacy = "Submit sends the selected summary, checks and findings to Carthagent and its external assessment provider (JEV). No transcript or whole project is uploaded. Review selected text for secrets before submitting. Project/outcome/run references stay with Carthagent. Assessment is not independent verification. Daily quests do not award coins or XP.\n\nRaw evidence: pending up to 24 hours, erased after processing; outages may delay cleanup. Metadata: 90 days. Provider policy applies; immediate provider/backup deletion is not promised. An interrupted send keeps an exact private local recovery copy for up to 24 hours, erased on acceptance or next journal access after expiry. Erase saved evidence removes that local copy, not a server job.";

export function DailyQuestsPage(props: { sessionID?: string; questID?: string; drafts?: Map<string, Map<string, unknown>> }) {
  const context = usePlugin();
  const dimensions = useTerminalDimensions();
  const compact = () => dimensions().height < 26;
  const location = () => (props.sessionID ? context.data.session.get(props.sessionID)?.location : undefined) ?? context.location ?? context.data.location.default();
  const [view, setView] = createSignal<View>({ busy: false, error: "", phase: "overview" });
  const [details, setDetails] = createSignal(false);
  const [notice, setNotice] = createSignal("");
  const [clock, setClock] = createSignal(Date.now());
  const [questIndex, setQuestIndex] = createSignal(0);
  const [completed, setCompleted] = createSignal(false);
  const visibleQuests = () => (view().snapshot?.slate.items ?? []).filter(q => (q.status === "assessed_complete") === completed());
  const completedCount = () => view().snapshot?.slate.items.filter(q => q.status === "assessed_complete").length ?? 0;
  const toggleCompleted = () => { if (!enabled() || view().detail) return; setCompleted(value => !value); setQuestIndex(0); summary?.scrollTo(0); };
  const cacheKey = JSON.stringify(location());
  if (props.drafts && !props.drafts.has(cacheKey)) props.drafts.set(cacheKey, new Map());
  const controller = createDailyQuestsState({ api: dailyQuestsClient(context, location), changed: (next: View) => setView(next), draftCache: props.drafts?.get(cacheKey) });
  const sourceApi = dailySourceClient(context, location);
  let summary: ScrollBoxRenderable | undefined;
  let actions: SelectRenderable | undefined;
  let activeDialog: symbol | undefined;
  const enabled = () => !view().busy && context.keymap.mode.current() === "base";
  const ownDialog = async <T,>(show: () => Promise<T>): Promise<T> => {
    const token = Symbol(); activeDialog = token;
    try { return await show(); } finally { if (activeDialog === token) activeDialog = undefined; }
  };
  const closeOwnDialog = () => { if (activeDialog) { activeDialog = undefined; context.ui.dialog.clear(); } };
  const confirm = (title: string, message: string, label: string) => ownDialog(() => context.ui.dialog.confirm({ title, message, label: { confirm: label, cancel: "Cancel" } }));
  const coding = () => context.ui.router.navigate(props.sessionID ? { type: "session", sessionID: props.sessionID } : { type: "home" });
  const resetFocus = () => { actions?.setSelectedIndex(0); summary?.scrollTo(0); };
  const moveQuest = (delta: number) => {
    const items = visibleQuests();
    const index = Math.max(0, Math.min(items.length - 1, questIndex() + delta));
    setQuestIndex(index);
    if (items[index]) summary?.scrollChildIntoView(`daily-quest-${items[index].id}`);
  };
  createEffect(() => {
    const count = visibleQuests().length;
    if (questIndex() >= count) setQuestIndex(Math.max(0, count - 1));
  });
  const back = () => {
    if (!enabled()) return;
    resetFocus();
    if (details()) { setDetails(false); return; }
    if (view().detail) { controller.overview(); return; }
    if (completed()) { toggleCompleted(); return; }
    coding();
  };
  context.keymap.layer(() => ({ priority: 30, commands: [
    { bind: "ctrl+u", title: "Scroll quest up", run: () => { summary?.scrollBy(-4); } },
    { bind: "ctrl+d", title: "Scroll quest down", run: () => { summary?.scrollBy(4); } },
    { bind: "escape", title: "Back", enabled, run: back },
    { bind: "up", title: "Previous choice", enabled, run: () => { if (view().detail || !view().snapshot) actions?.moveUp(); else moveQuest(-1); } },
    { bind: "down", title: "Next choice", enabled, run: () => { if (view().detail || !view().snapshot) actions?.moveDown(); else moveQuest(1); } },
    { bind: "return", title: "Select", enabled, run: () => { if (view().detail || !view().snapshot) { actions?.selectCurrent(); return; } const q = visibleQuests()[questIndex()]; if (q) void openQuest(q.id); } },
    { bind: "c", title: "Active / completed quests", enabled: () => enabled() && !view().detail, run: toggleCompleted },
    { bind: "s", title: "Character", enabled: () => enabled() && !view().detail, run: () => select("ship") },
    { bind: "r", title: "Refresh quests", enabled: () => enabled() && !view().detail, run: () => { void controller.refresh(); } },
  ] }));
  const evidence = (): DailyEvidence | undefined => view().preview?.evidence;
  const records = () => view().snapshot?.records ?? [];
  const pending = () => records().find(r => r.request || r.submission?.status === "queued" || r.submission?.status === "grading");
  const selectedRecord = () => records().filter(r => r.questId === view().detail?.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const chooseWork = async (automatic = false) => {
    await controller.compose(async (quest: DailyQuestDetail, live: () => boolean, signal: AbortSignal) => {
      // The UI cache contains visited sessions, not the complete durable inventory.
      // Read the current folder's inventory so a restart does not hide recorded work.
      const sessions = [...context.data.session.list().filter(s => s.location.directory === location().directory)];
      if (!automatic) {
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          const page = await context.client.session.list({ directory: location().directory, limit: 100, order: "desc", ...(cursor ? { cursor } : {}) }, { signal });
          if (!live()) return;
          for (const session of page.data) if (session.location.directory === location().directory && !sessions.some(s => s.id === session.id)) sessions.push(session);
          const next = page.cursor?.next;
          cursor = next && !seen.has(next) ? next : undefined;
          if (cursor) seen.add(cursor);
        } while (cursor);
      }
      const sources = new Map<string, Awaited<ReturnType<typeof sourceApi.report>>>();
      let unreadable = 0;
      if (!automatic) {
        for (let i = 0; i < sessions.length && live(); i += 4) {
          await Promise.all(sessions.slice(i, i + 4).map(async s => {
            try { const result = await sourceApi.report({ sessionID: s.id }, AbortSignal.any([signal, AbortSignal.timeout(15_000)])); if (result.source) sources.set(s.id, result); }
            catch { unreadable++; }
          }));
        }
        if (!live()) return;
        if (!sources.size) { setNotice(unreadable ? "Could not read recorded work from some sessions. Refresh and try choosing work again." : "No recorded Ship work in this folder yet. Finish a task in Ship mode, then return here."); return; }
        if (unreadable) setNotice("Some sessions could not be read. Showing available recorded work; try again if yours is missing.");
      }
      const sessionID = automatic ? props.sessionID : await ownDialog(() => context.ui.dialog.select({
        title: "Choose completed work",
        options: sessions.filter(s => sources.has(s.id)).map(s => ({ title: s.title || "Untitled session", value: s.id, description: sources.get(s.id)?.source?.freshness === "stale" ? "Checks need refreshing" : "Recorded Ship work" })),
      }));
      if (!sessionID || !live()) return;
      const { source } = sources.get(sessionID) ?? await sourceApi.report({ sessionID }, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
      if (!live()) return;
      if (!source) { if (!automatic) setNotice("No recorded Ship delivery in that session. Finish the task in Ship mode, then choose it here."); return; }
      const session = sessions.find(s => s.id === sessionID) ?? context.data.session.get(sessionID);
      const project = reference("daily-project-v1", session?.projectID ?? location().directory);
      const selected: DailyEvidence = {
        projectId: project, outcomeId: reference("daily-outcome-v1", project, source.runId), runId: source.runId,
        revision: source.revision, goal: source.goal, change: source.change,
        checks: source.checks.map(({ id, before, after, revision, result }) => ({ name: id, before, after, revision, result })),
        findings: source.findings.map(({ issue, evidence, resolution }) => ({ issue, evidence, resolution })),
      };
      const bounded = selectedQuestEvidence(selected, quest.definition.kind);
      setNotice([source.truncated || bounded.omitted ? "Some recorded evidence exceeded the size limit and was omitted. Review selected work in Details." : "", source.freshness === "stale" ? "This work has changed since verification. Run its checks again in Ship mode." : ""].filter(Boolean).join(" "));
      return { id: randomUUID(), evidence: bounded.evidence, provenance: session?.title && session.title !== "New session" ? session.title : source.goal.slice(0, 100) || "Selected Ship session" };
    });
    controller.preview();
    resetFocus();
  };
  const openQuest = async (id: string) => {
    resetFocus(); setDetails(false); setNotice("");
    await controller.select(id);
    if (props.sessionID && !view().draft && view().detail?.status === "open" && !pending()) await chooseWork(true);
  };
  const submit = async () => {
    // Clicking Submit is authorization for the frozen selection shown on this page.
    // The controller still binds it to the account, quest and live page lifetime.
    if (!view().preview || pending()) return;
    await controller.submit(async () => true);
    resetFocus();
  };
  const editSelection = () => controller.compose(async (_quest: DailyQuestDetail, live: () => boolean) => {
    const saved = view().preview;
    if (!saved) return;
    const selected = structuredClone(saved.evidence);
    const field = await ownDialog(() => context.ui.dialog.select({ title: "Edit selected work", options: [
      { title: "Edit goal", value: "goal" }, { title: "Edit change summary", value: "change" },
      ...selected.checks.map((c, i) => ({ title: `Remove check: ${c.name}`, value: `check:${i}` })),
      ...selected.findings.map((f, i) => ({ title: `Remove finding: ${f.issue}`, value: `finding:${i}` })),
    ] }));
    if (!field || !live()) return;
    if (field === "goal" || field === "change") {
      const text = await ownDialog(() => context.ui.dialog.prompt({ title: field === "goal" ? "Goal" : "Change summary", value: selected[field] }));
      if (text === undefined || !live()) return;
      selected[field] = text;
    } else {
      const [kind, index] = field.split(":");
      if (kind === "check") selected.checks.splice(Number(index), 1); else selected.findings.splice(Number(index), 1);
    }
    return { id: saved.id, evidence: selected, provenance: view().draft?.provenance ?? "Selected work" };
  }).then(() => controller.preview());
  const options = () => {
    const state = view(), q = state.detail;
    const option = (name: string, value: string) => ({ name, value, description: "" });
    if (details()) return [option("Back to quest", "back"), ...(state.draft ? [option("Edit selected work", "edit")] : []),
      ...records().filter(r => r.request).flatMap(r => [option("Retry saved submission", `retry:${r.id}`), option("Erase saved evidence", `forget:${r.id}`)])];
    if (!state.snapshot) return [option("Refresh", "refresh"), option("Sign in", "signin"), option("Back to coding", "back")];
    if (!q) return [];
    const record = selectedRecord();
    if (q.status === "assessed_complete") return [option("Back to quests", "back"), option("Details", "details")];
    return [
      ...(pending() ? [option("Check submission status", `poll:${pending()!.id}`)] : q.status === "open" ? [option(state.preview ? "Submit" : "Choose completed work", state.preview ? "submit" : "choose")] : []),
      ...(q.status === "open" && state.preview ? [option("Change work", "choose")] : []),
      ...(record?.request ? [option("Retry saved submission", `retry:${record.id}`)] : []),
      option("Details", "details"), option("Back to quests", "back"),
    ];
  };
  const select = (value?: string) => {
    if (!value || !enabled()) return;
    if (value === "back") return back();
    if (value === "coding") return coding();
    if (value === "details") { resetFocus(); setDetails(true); return; }
    if (value === "edit") { void editSelection(); return; }
    if (value === "choose") { setNotice(""); void chooseWork(); return; }
    if (value === "submit") { void submit(); return; }
    if (value === "refresh") { void controller.refresh(); return; }
    if (value === "signin") { controller.invalidate(); closeOwnDialog(); context.keymap.dispatch("provider.connect"); return; }
    if (value === "ship") { context.ui.router.navigate({ type: "plugin", name: "voyages", data: { sessionID: props.sessionID, section: "profile" } }); return; }
    const id = value.slice(value.indexOf(":") + 1);
    if (value.startsWith("quest:")) void openQuest(id);
    if (value.startsWith("poll:")) void controller.poll(id);
    if (value.startsWith("retry:")) void controller.retry(id, () => confirm("Retry saved submission?", "Check whether the server received it, then resend the same saved work only if absent.", "Retry"));
    if (value.startsWith("forget:")) void controller.forget(id, () => confirm("Erase saved evidence?", "Keep the submission ID for status checks. The saved work cannot be resent afterward. This does not cancel an accepted assessment.", "Erase"));
  };
  onMount(() => {
    let binding = JSON.stringify(location());
    const stop = context.data.listen(({ details: event }) => {
      const next = JSON.stringify(location()), changedLocation = binding !== next; binding = next;
      void handleDailyQuestsEvent({ controller, event, location: location(), changedLocation, actions,
        interrupted: !!(view().draft || activeDialog), clearReplay: () => setDetails(false), closeDialog: closeOwnDialog, notice: setNotice });
    });
    void controller.refresh().then(async () => {
      if (props.questID) await openQuest(props.questID);
      const record = pending();
      if (record) await controller.poll(record.id, { follow: false });
    });
    createEffect(on(() => props.questID, id => { if (id) void openQuest(id); }, { defer: true }));
    const timer = setInterval(() => {
      setClock(Date.now());
      const record = pending();
      if (record?.submission && !view().busy && !activeDialog) void controller.poll(record.id, { follow: false });
    }, 5000);
    onCleanup(() => { clearInterval(timer); stop(); controller.dispose(); closeOwnDialog(); });
  });
  return <box flexDirection="column" flexGrow={1} minHeight={0} paddingX={2} paddingY={1} overflow="hidden" backgroundColor={context.theme.background.base}>
    <box flexDirection="row" flexShrink={0} paddingBottom={compact() ? 0 : 1}>
      <text flexShrink={0} fg={context.theme.text.base} attributes={TextAttributes.BOLD}>{details() ? "Quest details" : completed() && !view().detail ? "Completed quests" : "Quests"}</text>
      <box flexGrow={1} />
      <Show when={view().snapshot}><text fg={context.theme.text.muted}>{questReset(view().snapshot!.slate.endsAt, clock())}</text></Show>
    </box>
    <scrollbox ref={summary} flexBasis={0} flexGrow={1} minHeight={1} overflow="hidden" contentOptions={{ flexDirection: "column" }}>
      <Show when={view().busy}><text flexShrink={0} fg={context.theme.text.muted}>Loading…</text></Show>
      <Show when={view().error}><text flexShrink={0} fg={context.theme.text.feedback.error.base}>{view().error}</text></Show>
      <Show when={notice()}><text flexShrink={0} fg={context.theme.text.feedback.warning.base}>{notice()}</text></Show>
      <Show when={!view().detail && view().snapshot}>{(snapshot) => <box flexShrink={0} flexDirection="column">
        <Show when={!visibleQuests().length}><box paddingY={1} flexDirection="column" flexShrink={0}>
          <text fg={context.theme.text.base}>{completed() ? "No completed quests yet" : snapshot().slate.items.length ? "All quests complete" : "No quests today"}</text>
          <Show when={!completed()}><text fg={context.theme.text.muted}>New quests at the next reset.</text></Show>
        </box></Show>
        <For each={visibleQuests()}>{(q, index) => <box id={`daily-quest-${q.id}`} flexDirection="column" flexShrink={0} marginTop={1} paddingX={2} paddingY={compact() ? 0 : 1} backgroundColor={questIndex() === index() ? context.theme.background.raised.high : context.theme.background.raised.base} onMouseUp={() => { if (enabled()) { setQuestIndex(index()); void openQuest(q.id); } }}>
          <text flexShrink={0} fg={questIndex() === index() ? context.theme.text.formfield.focused : context.theme.text.base} attributes={TextAttributes.BOLD}>{questIndex() === index() ? "› " : "  "}{q.status === "assessed_complete" ? "✓ " : ""}{questCopy(q).title}</text>
          <text flexShrink={0} fg={context.theme.text.base}>{questCopy(q).goal}</text>
          <text flexShrink={0} fg={q.status === "assessed_complete" ? context.theme.text.feedback.success.base : context.theme.text.action.primary.base}>{questStatus(q, records())} →</text>
        </box>}</For>
      </box>}</Show>
      <Show when={view().detail}>{q => <box flexDirection="column" flexShrink={0}>
        <text flexShrink={0} fg={context.theme.text.base} attributes={TextAttributes.BOLD}>{questCopy(q()).title}</text>
        <text flexShrink={0} fg={context.theme.text.base}>{questCopy(q()).goal}</text>
        <Show when={q().status === "assessed_complete"} fallback={<>
          <Show when={!q().latestSubmission || view().preview || details()}><box flexDirection="column" flexShrink={0} marginTop={1} paddingX={2} paddingY={compact() ? 0 : 1} backgroundColor={context.theme.background.raised.base}>
          <text flexShrink={0} fg={context.theme.text.muted}>What counts</text>
          <For each={questConditions(q(), evidence())}>{c => <text flexShrink={0} fg={context.theme.text.base}>{c.detected ? "•" : "○"} {c.text}{c.detected ? " · recorded" : ""}</text>}</For>
          </box></Show>
          <box flexDirection="column" flexShrink={0} marginTop={1} paddingX={2} paddingY={compact() ? 0 : 1} backgroundColor={context.theme.background.raised.base}>
          <text flexShrink={0} fg={context.theme.text.muted}>{view().preview || !q().latestSubmission ? "Selected work" : "Submitted work"}</text>
          <text flexShrink={0} fg={context.theme.text.base}>{view().draft?.provenance ?? (q().latestSubmission ? "Submission received. See assessment below." : "Choose a completed Ship session")}</text>
          </box>
        </>}><box flexDirection="column" flexShrink={0} marginTop={1} padding={2} backgroundColor={context.theme.background.raised.base}>
          <text flexShrink={0} fg={context.theme.text.feedback.success.base} attributes={TextAttributes.BOLD}>✓ Quest complete</text>
          <text flexShrink={0} fg={context.theme.text.base}>Your submitted work met all the conditions.</text>
        </box></Show>
        <Show when={q().status !== "assessed_complete" && q().latestSubmission}>{s => <>
          <text flexShrink={0}>{submissionText(s())}</text>
          <For each={assessmentFeedback(q(), s())}>{text => <text flexShrink={0}>Needs evidence: {text}</text>}</For>
        </>}</Show>
        <Show when={selectedRecord() && !selectedRecord()?.submission}><text flexShrink={0}>Submission not confirmed. Your saved request is available for a status check.</text></Show>
        <Show when={details()}>
          <text flexShrink={0} marginTop={1}>{privacy}</text>
          <text flexShrink={0}>Quest {q().id} · closes {q().endsAt} · rubric {q().definition.rubricVersion}</text>
          <For each={q().definition.criteria}>{c => <text flexShrink={0}>{c.id}: {c.text}</text>}</For>
          <Show when={evidence()}>{e => <>
            <text flexShrink={0}>Goal: {e().goal}{"\n"}Change: {e().change}{"\n"}Revision: {e().revision}</text>
            <For each={e().checks}>{c => <text flexShrink={0}>{c.name}: {c.before} → {c.after}{"\n"}{c.result}</text>}</For>
            <For each={e().findings}>{f => <text flexShrink={0}>{f.issue}{"\n"}{f.evidence}{"\n"}{f.resolution}</text>}</For>
          </>}</Show>
          <For each={records()}>{r => <text flexShrink={0}>{`Submission ${r.id}\n${r.submission ? JSON.stringify(r.submission, null, 2) : r.request ? JSON.stringify(r.request, null, 2) : "Saved evidence erased; status checks remain available."}`}</text>}</For>
        </Show>
      </box>}</Show>
    </scrollbox>
    <Show when={view().preview && !details() && view().detail?.status === "open"}>
      <text flexShrink={0} fg={context.theme.text.muted}>Submit shares this work with Carthagent & its assessor. See Details.</text>
    </Show>
    <Show when={view().detail || !view().snapshot} fallback={<box flexDirection="row" flexShrink={0} gap={1} paddingTop={1}>
      <text fg={context.theme.text.action.secondary.base} onMouseUp={toggleCompleted}>c {completed() ? "Active" : `Completed (${completedCount()})`}</text>
      <text fg={context.theme.text.action.secondary.base} onMouseUp={() => select("ship")}>s Character</text>
      <text fg={context.theme.text.action.secondary.base} onMouseUp={() => select("refresh")}>r Refresh</text>
      <text fg={context.theme.text.action.secondary.base} onMouseUp={coding}>Esc Coding</text>
    </box>}>
      <select ref={actions} height={Math.min(4, options().length)} flexShrink={0} backgroundColor={context.theme.background.base} focusedBackgroundColor={context.theme.background.base} focusedTextColor={context.theme.text.action.secondary.base} textColor={context.theme.text.action.secondary.base} selectedTextColor={context.theme.text.formfield.focused} selectedBackgroundColor={context.theme.background.formfield.focused} showDescription={false} showScrollIndicator options={options()} focused={enabled()} onMouseUp={event => { if (enabled()) clickSelect(actions, event); }} onSelect={(_index, option) => select(option?.value)} />
    </Show>
    <text flexShrink={0} fg={context.theme.text.muted}>↑↓ Enter select · Ctrl+U/D scroll · Esc back</text>
  </box>;
}
