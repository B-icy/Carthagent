/** @jsxImportSource @opentui/solid */
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { createHash, randomUUID } from "node:crypto";
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { usePlugin } from "@opencode/plugin/tui";
import { dailyQuestsClient, dailySourceClient } from "./client.js";
import type { DailyEvidence, DailyQuestDetail, DailySnapshot, DailySubmission, DailyRecord } from "../daily-quests-rpc.js";
import type { DailySourceReport } from "../daily-source-rpc.js";
import { createDailyQuestsState, dailySubmissionLabel } from "./daily-quests-state.mjs";
import { voyagesEventAction } from "./voyages-state.mjs";
import { syncDailyEditor } from "./daily-editor.mjs";

type Request = NonNullable<DailyRecord['request']>;
type View = {
  snapshot?: DailySnapshot; detail?: DailyQuestDetail; busy: boolean; error: string;
  draft?: { accountKey: string; questId: string; id: string; text: string; provenance: string };
  preview?: Request; phase: "overview" | "edit" | "preview";
};

/** Stable opaque references, not proof of authorship. Never send a local path. */
function reference(...parts: string[]) {
  const h = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const privacy = "Only the exact preview below is sent to Carthagent. External JEV receives the revision, goal, change, checks, findings and server rubric, not project/outcome/run IDs. No transcript or whole project is uploaded. Review and remove secrets yourself; automatic secret detection is not provided.\n\nBackend raw evidence: pending up to 24 hours, erased on terminal processing (outages can delay cleanup). Metadata: 90 days. Provider policy applies; immediate provider/backup deletion is not promised. Unknown-send recovery stores this exact payload in a private local journal until acceptance is known or for up to 24 hours on the next journal access, not a background deletion timer. You can erase its local payload while retaining the submission ID.\n\nClassifier assessment is not independent verification. No coins, XP, distance, inventory or other rewards. Signing in or running Ship is not consent.";

export function DailyQuestsPage(props: { sessionID?: string }) {
  const context = usePlugin();
  const location = () => (props.sessionID ? context.data.session.get(props.sessionID)?.location : undefined) ?? context.location ?? context.data.location.default();
  const [view, setView] = createSignal<View>({ busy: false, error: "", phase: "overview" });
  const [editorFocus, setEditorFocus] = createSignal(true);
  const [replayID, setReplayID] = createSignal<string>();
  const controller = createDailyQuestsState({ api: dailyQuestsClient(context, location), changed: (next: View) => setView(next) });
  const sourceApi = dailySourceClient(context, location);
  let summary: ScrollBoxRenderable | undefined;
  let editor: TextareaRenderable | undefined;
  const preview = () => { if (view().phase === "edit") syncDailyEditor(editor, controller); controller.preview(); };
  let activeDialog: symbol | undefined;
  const ownDialog = async <T,>(show: () => Promise<T>): Promise<T> => {
    const token = Symbol(); activeDialog = token;
    try { return await show(); } finally { if (activeDialog === token) activeDialog = undefined; }
  };
  const closeOwnDialog = () => {
    if (!activeDialog) return;
    activeDialog = undefined;
    context.ui.dialog.clear();
  };
  const confirm = (title: string, message: string, label: string) => ownDialog(() => context.ui.dialog.confirm({ title, message, label: { confirm: label, cancel: "Cancel" } }));
  context.keymap.layer(() => ({ commands: [
    { bind: "ctrl+u", title: "Scroll daily quest preview up", run: () => { summary?.scrollBy(-1); } },
    { bind: "ctrl+d", title: "Scroll daily quest preview down", run: () => { summary?.scrollBy(1); } },
    { bind: "ctrl+p", title: "Validate daily evidence preview", enabled: () => view().phase === "edit" && !view().busy, run: preview },
    { bind: "tab", title: "Switch evidence editor / actions", enabled: () => view().phase === "edit" && !view().busy, run: () => { setEditorFocus((focused) => !focused); } },
  ] }));

  const chooseProjection = async (source: DailySourceReport, sessionID: string, live: () => boolean): Promise<DailyEvidence | undefined> => {
    let goal = false, change = false;
    const checks = new Set<string>(), findings = new Set<string>();
    while (live()) {
      const selected = await ownDialog(() => context.ui.dialog.select({
        title: "Select local evidence · nothing included by default",
        options: [
          { title: "Done selecting", value: "done", description: "Open editable JSON; nothing is sent yet" },
          { title: `${goal ? "Remove" : "Include"} recorded goal`, value: "goal", description: "May contain private task text" },
          { title: `${change ? "Remove" : "Include"} recorded change`, value: "change", description: source.change ? "Recorded claim, not independently verified" : "Not recorded; remains empty" },
          ...source.checks.map((c) => ({ title: `${checks.has(c.id) ? "Remove" : "Include"} check ${c.id}`, value: `check:${c.id}`, description: `${c.after} · ${c.after === "passed" ? "fresh" : "not fresh"} · includes output tail, potentially sensitive; before not recorded` })),
          ...source.findings.map((f) => ({ title: `${findings.has(f.id) ? "Remove" : "Include"} finding ${f.id}`, value: `finding:${f.id}`, description: "Includes issue, evidence and resolution text; model/user-authored claim" })),
        ],
      }));
      if (!live() || selected === undefined) return;
      if (selected === "done") break;
      if (selected === "goal") goal = !goal;
      else if (selected === "change") change = !change;
      else {
        const isCheck = selected.startsWith("check:");
        const id = selected.slice(isCheck ? 6 : 8), set = isCheck ? checks : findings;
        if (set.has(id)) set.delete(id); else set.add(id);
      }
    }
    if (!live()) return;
    const session = context.data.session.get(sessionID);
    const project = reference("daily-project-v1", session?.projectID ?? location().directory);
    return {
      projectId: project, outcomeId: reference("daily-outcome-v1", project, source.runId), runId: source.runId,
      revision: source.revision, goal: goal ? source.goal : "", change: change ? source.change : "",
      checks: source.checks.filter((c) => checks.has(c.id)).map(({ id, before, after, revision, result }) => ({ name: id, before, after, revision, result })),
      findings: source.findings.filter((f) => findings.has(f.id)).map(({ issue, evidence, resolution }) => ({ issue, evidence, resolution })),
    };
  };

  const compose = () => controller.compose(async (_quest: DailyQuestDetail, live: () => boolean, signal: AbortSignal) => {
    const kind = await ownDialog(() => context.ui.dialog.select({ title: "Choose evidence source", options: [
      { title: "Select actual local Ship report", value: "local", description: "Owned session only; choose individual checks/findings, no transcript" },
      { title: "Write a structured manual claim", value: "manual", description: "Blank evidence, not a claim that checks ran; edit every field" },
    ] }));
    if (!kind || !live()) return;
    if (kind === "manual") {
      const project = reference("daily-project-v1", props.sessionID ? context.data.session.get(props.sessionID)?.projectID ?? location().directory : location().directory);
      return { id: randomUUID(), evidence: { projectId: project, outcomeId: randomUUID(), runId: randomUUID(), revision: "", goal: "", change: "", checks: [], findings: [] }, provenance: "Manual user claim. Enter a genuine 40/64-hex revision. Empty evidence does not establish completion. Keep project/outcome/run IDs when revising the same outcome; they do not prove authorship." };
    }
    const sessions = context.data.session.list().filter((s) => s.location.directory === location().directory);
    const sessionID = props.sessionID ?? await ownDialog(() => context.ui.dialog.select({ title: "Choose local Ship session", options: sessions.map((s) => ({ title: s.title ?? s.id, value: s.id, description: s.id })) }));
    if (!sessionID || !live()) return;
    const { source } = await sourceApi.report({ sessionID }, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
    if (!live()) return;
    if (!source) throw new Error("daily_source_unavailable");
    const evidence = await chooseProjection(source, sessionID, live);
    if (!evidence || !live()) return;
    return { id: randomUUID(), evidence, provenance: `Local Ship session ${sessionID} · run ${source.runId} · plan revision ${source.planRevision} · ${source.freshness}. Source revision is the actual workspace fingerprint, not the plan revision. Earlier failed-before execution is not recorded and is never inferred. Selected text is editable and remains a user claim, not independent verification.${source.truncated ? " Source projection is truncated; inspect and correct missing details before submitting." : ""}` };
  });

  const submit = () => controller.submit(({ quest, request }: { quest: DailyQuestDetail; request: Request }) => confirm(
    "Explicit consent for this one JEV submission",
    `${quest.definition.title}\nSubmission ${request.id}\nSend only the exact JSON shown in the scrollable preview to Carthagent for external JEV grading? Review/redact before consent. Raw backend evidence: pending up to 24h, erased on terminal processing; metadata 90d. Outages can delay cleanup. Provider/backup deletion is not guaranteed. No rewards or independent verification.\n\nCancel to review the preview and full retention notice again. This authorizes this submission only.`,
    "Consent and send",
  ));
  const retry = (id: string) => controller.retry(id, (record: DailyRecord) => confirm("Retry the SAME consented submission?", `Submission ${record.id}\nReplay only the exact saved ID/body shown in the scrollable recovery preview to Carthagent/external JEV under the same retention notice? Poll first when possible. This cannot edit evidence or create a replacement ID. Cancel keeps it pending.`, "Replay same request"));
  const forget = (id: string) => controller.forget(id, (record: DailyRecord) => confirm("Erase local recovery payload?", `Submission ${record.id}\nErase the selected evidence from the local journal. Keep the stable submission/quest IDs for read-only status checks. Exact replay will no longer be possible. This does not cancel a server job, withdraw evidence already sent, or promise provider/backup deletion.`, "Erase local payload"));

  const statusText = (submission: DailySubmission) => `${dailySubmissionLabel(submission)}\nSubmission ${submission.id} · provider attempts ${submission.attempts}/4\nCreated ${submission.createdAt}${submission.nextAttemptAt ? ` · next attempt ${submission.nextAttemptAt}` : ""}${submission.finishedAt ? ` · finished ${submission.finishedAt}` : ""}${submission.errorCode ? `\nProcessing code: ${submission.errorCode}` : ""}${submission.model ? `\nModel ${submission.model} · rubric ${submission.rubricVersion}` : ""}${submission.scores ? `\nUncalibrated rubric scores (not confidence): ${Object.entries(submission.scores).map(([id, score]) => `${id}: ${score}`).join(" · ")}` : ""}`;
  const options = () => {
    const state = view(), detail = state.detail;
    const basic = [
      { name: "Refresh daily assignments and recovery journal", description: "Read-only; never uploads or replays evidence", value: "refresh" },
      { name: "Sign in / reconnect", description: "Native Carthagent Ship device sign-in; not grading consent", value: "signin" },
      { name: "Back to Voyages", description: "Discard unsent editor contents", value: "back" },
    ];
    if (!state.snapshot) return basic;
    return [...basic,
      ...(replayID() ? [
        { name: "Confirm exact saved replay…", description: "Review the scrollable recovery preview first; explicit same-ID replay", value: "confirm-replay" },
        { name: "Close recovery preview", description: "No replay; keep saved payload", value: "close-replay" },
      ] : []),
      ...state.snapshot.slate.items.map((q) => ({ name: `${q.definition.title} · ${q.status}`, description: `${q.definition.kind} · UTC window ends ${q.endsAt}`, value: `quest:${q.id}` })),
      ...(detail?.status === "open" && !state.draft ? [{ name: "Choose evidence for selected quest", description: "Select local report data or write a manual claim; no upload", value: "compose" }] : []),
      ...(state.phase === "edit" ? [{ name: "Validate and preview exact payload", description: "Ctrl+P; canonical UTF-8 limits, no network", value: "preview" }] : []),
      ...(state.phase === "preview" ? [
        { name: "Consent and submit this preview…", description: "Fresh explicit consent dialog; no automatic acceptance or rewards", value: "submit" },
        { name: "Edit / redact evidence again", description: "Invalidates the preview; requires validation and fresh consent", value: "edit" },
      ] : []),
      ...(state.draft ? [{ name: "Discard unsent evidence", description: "Clear local editor; no submission", value: "cancel" }] : []),
      ...(detail?.latestSubmission ? [{ name: "Poll selected quest's latest submission", description: "Read-only authoritative status; no provider dispatch", value: `poll:${detail.latestSubmission.id}` }] : []),
      ...state.snapshot.records.flatMap((r) => [
        { name: `Poll saved ${r.id}`, description: r.submission ? dailySubmissionLabel(r.submission) : "Outcome unknown; stable ID retained, including previous UTC days", value: `poll:${r.id}` },
        ...(r.request ? [
          { name: `Review exact replay ${r.id}`, description: "Saved same ID/body; explicit confirmation, never automatic", value: `retry:${r.id}` },
          { name: `Erase local payload ${r.id}`, description: "Keep ID for polling; cannot replay afterward", value: `forget:${r.id}` },
        ] : []),
      ]),
    ];
  };
  const select = (value?: string) => {
    if (!value || view().busy) return;
    if (value === "back") { context.ui.router.navigate({ type: "plugin", name: "voyages", data: { ...(props.sessionID ? { sessionID: props.sessionID } : {}) } }); return; }
    if (value === "signin") { controller.invalidate(); closeOwnDialog(); context.keymap.dispatch("provider.connect"); return; }
    if (value === "refresh") { setReplayID(undefined); void controller.refresh(); return; }
    if (value === "compose") { setEditorFocus(true); void compose(); return; }
    if (value === "preview") { preview(); return; }
    if (value === "submit") { void submit(); return; }
    if (value === "edit") { setEditorFocus(true); controller.backToEdit(); return; }
    if (value === "cancel") { controller.cancelDraft(); return; }
    if (value === "close-replay") { setReplayID(undefined); return; }
    if (value === "confirm-replay") { const id = replayID(); if (id) { void retry(id).finally(() => setReplayID(undefined)); } return; }
    const colon = value.indexOf(":"), id = value.slice(colon + 1);
    if (value.startsWith("quest:")) void controller.select(id);
    if (value.startsWith("poll:")) void controller.poll(id);
    if (value.startsWith("retry:")) { controller.cancelDraft(); setReplayID(id); }
    if (value.startsWith("forget:")) void forget(id);
  };
  onMount(() => {
    let binding = JSON.stringify(location());
    const stop = context.data.listen(({ details }) => {
      const changedLocation = binding !== JSON.stringify(location());
      const action = changedLocation ? String(details.type) === "server.disconnected" ? "clear" : "refresh" : voyagesEventAction(details, location());
      if (action === "ignore") return;
      binding = JSON.stringify(location()); setReplayID(undefined); controller.invalidate(); closeOwnDialog();
      if (action === "refresh") void controller.refresh();
    });
    void controller.refresh();
    onCleanup(() => { stop(); controller.dispose(); closeOwnDialog(); });
  });
  return <box flexDirection="column" flexGrow={1} padding={1}>
    <text flexShrink={0} fg={context.theme.text.action.primary.base}>CARTHAGENT · DAILY CODING QUESTS</text>
    <scrollbox ref={summary} flexBasis={0} flexGrow={1} minHeight={1} contentOptions={{ flexDirection: "column" }}>
      <text flexShrink={0} fg={context.theme.text.muted}>Classifier-assessed submitted evidence, not independent verification. No rewards. Refresh/poll never uploads evidence.</text>
      <Show when={view().busy}><text flexShrink={0} fg={context.theme.text.feedback.warning.base}>Awaiting response / explicit selection or consent. Other actions locked.</text></Show>
      <Show when={view().error}><text flexShrink={0} fg={context.theme.text.feedback.error.base}>{view().error}</text></Show>
      <Show when={view().snapshot} fallback={<text flexShrink={0} fg={context.theme.text.muted}>Protected assignments and evidence hidden until successful authentication and refresh.</text>}>{(snapshot) => <box flexDirection="column" flexShrink={0}>
        <text flexShrink={0} fg={context.theme.text.base}>UTC day {snapshot().slate.day} · closes {snapshot().slate.endsAt} · policy {snapshot().slate.policyVersion}</text>
        <text flexShrink={0} fg={context.theme.text.muted}>New submissions close at the server's UTC boundary. Accepted jobs can finish afterward. Select a quest below for its actual criteria.</text>
        <For each={snapshot().records}>{(r) => <text flexShrink={0} fg={context.theme.text.muted}>{r.submission ? statusText(r.submission) : `Outcome unknown / no confirmed acceptance · submission ${r.id} · quest ${r.questId}${r.request ? " · exact replay payload available" : " · payload erased; poll ID only"}`}</text>}</For>
      </box>}</Show>
      <Show when={view().detail}>{(detail) => <box flexDirection="column" flexShrink={0}>
        <text flexShrink={0} fg={context.theme.text.action.primary.base}>{detail().definition.title} · {detail().status}</text>
        <text flexShrink={0} fg={context.theme.text.muted}>Quest {detail().id} · {detail().definition.kind} · ends {detail().endsAt} · rubric {detail().definition.rubricVersion}</text>
        <For each={detail().definition.criteria}>{(c) => <text flexShrink={0} fg={context.theme.text.base}>{c.id}: {c.text}</text>}</For>
        <Show when={detail().latestSubmission}>{(s) => <text flexShrink={0} fg={context.theme.text.base}>{statusText(s())}</text>}</Show>
      </box>}</Show>
      <Show when={view().draft}><text flexShrink={0} fg={context.theme.text.muted}>{view().draft?.provenance}</text></Show>
      <Show when={view().phase === "preview" && view().preview}>
        <text flexShrink={0} fg={context.theme.text.base}>{privacy}</text>
        <text flexShrink={0} fg={context.theme.text.base}>{`Exact request for quest ${view().draft?.questId}:\n${JSON.stringify(view().preview, null, 2)}`}</text>
      </Show>
      <Show when={view().snapshot?.records.find((r) => r.id === replayID() && r.request)}>{(record) => <box flexDirection="column" flexShrink={0}>
        <text flexShrink={0} fg={context.theme.text.base}>{privacy}</text>
        <text flexShrink={0} fg={context.theme.text.base}>{`Exact saved recovery request · quest ${record().questId}:\n${JSON.stringify(record().request, null, 2)}`}</text>
      </box>}</Show>
    </scrollbox>
    <Show when={view().phase === "edit" && view().draft}>
      <text flexShrink={0} fg={context.theme.text.faint}>Redact JSON · Tab actions · Ctrl+P preview, never sends</text>
      <textarea ref={editor} flexBasis={0} flexGrow={1} minHeight={2} initialValue={view().draft?.text ?? ""} focused={editorFocus() && !view().busy && context.keymap.mode.current() === "base"} onContentChange={() => syncDailyEditor(editor, controller)} keyBindings={[{ name: "p", ctrl: true, action: "submit" }]} onSubmit={preview} />
    </Show>
    <text flexShrink={0} fg={context.theme.text.faint}>↑/↓ Enter · PgUp/Dn · Ctrl+U/D details · Cancel: no send</text>
    <select flexBasis={0} flexGrow={1} flexShrink={0} minHeight={3} showScrollIndicator options={options()} focused={(view().phase !== "edit" || !editorFocus()) && context.keymap.mode.current() === "base"} keyBindings={[{ name: "pageup", action: "move-up-fast" }, { name: "pagedown", action: "move-down-fast" }]} onSelect={(_index, option) => select(option?.value)} />
  </box>;
}
