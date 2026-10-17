/** @jsxImportSource @opentui/solid */
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { usePlugin } from "@opencode/plugin/tui";
import { rpcEventOptions, workspaceClient, type WorkspaceSnapshot } from "./client.js";

function sessionAttention(context: ReturnType<typeof usePlugin>, sessionID: string) {
  return (context.data.session.permission.list(sessionID)?.length ?? 0) + (context.data.session.form.list(sessionID)?.length ?? 0);
}

export function WorkspacePage(props: { view: string; refreshKey?: string; sessionID?: string }) {
  const context = usePlugin();
  const [snapshot, setSnapshot] = createSignal<WorkspaceSnapshot>();
  const [activeSessions, setActiveSessions] = createSignal<Record<string, { type: "running" }>>({});
  const [deliveryEvidence, setDeliveryEvidence] = createSignal<unknown>();
  const [reviewEvidence, setReviewEvidence] = createSignal<unknown>();
  const [inventorySessions, setInventorySessions] = createSignal<ReturnType<typeof context.data.session.list>>([]);
  const [query, setQuery] = createSignal("");
  const [error, setError] = createSignal("");
  const route = context.ui.router.current();
  const currentSessionID = () => props.sessionID ?? (route.type === "session" ? route.sessionID : undefined);
  const sessionLocation = () => currentSessionID() ? context.data.session.get(currentSessionID()!)?.location : undefined;
  const api = workspaceClient(context, sessionLocation());
  const activeSession = () => {
    const activeRoute = context.ui.router.current();
    return activeRoute.type === "plugin" ? activeRoute.data?.sessionID ?? props.sessionID : activeRoute.type === "session" ? activeRoute.sessionID : props.sessionID;
  };
  const localSessions = () => inventorySessions().filter((session) => !session.parentID);
  const syncNativeSessions = async () => {
    const all = [] as ReturnType<typeof context.data.session.list>;
    let cursor: string | undefined;
    do {
      const page = await context.client.session.list({ limit: 100, order: "desc", ...(cursor ? { cursor } : {}) });
      all.push(...page.data);
      cursor = page.cursor.next ?? undefined;
    } while (cursor);
    setInventorySessions(all);
    const sessions = all.filter((session) => !session.parentID);
    await Promise.allSettled(sessions.flatMap((session) => [
      context.data.session.sync(session.id),
      context.data.session.permission.sync(session.id),
      context.data.session.form.sync(session.id, session.location),
    ]));
  };
  type WorkspaceSession = { id: string; title: string; directory: string; status: string; projectID?: string; attention?: number };
  const workspaceSessions = (): WorkspaceSession[] => {
    const snapshotSessions = snapshot()?.sessions ?? [];
    const known = new Set(snapshotSessions.map((session) => session.id));
    const projectIDs = new Set(snapshot()?.projects.map((project) => project.id) ?? []);
    const projectDirectories = new Set(snapshot()?.projects.map((project) => project.directory) ?? []);
    const nativeSessions = localSessions().filter((session) => !known.has(session.id) &&
      (projectIDs.has(session.projectID) || projectDirectories.has(session.location.directory)));
    return [
      ...snapshotSessions.map((session): WorkspaceSession => ({ id: session.id, title: session.title, directory: session.directory, status: session.status, projectID: session.projectID, attention: sessionAttention(context, session.id) })),
      ...nativeSessions.map((session) => ({ id: session.id, title: session.title ?? session.id, directory: session.location.directory, status: activeSessions()[session.id]?.type === "running" ? "running" : "idle", projectID: session.projectID, attention: sessionAttention(context, session.id) })),
    ].filter((session) => !query() || `${session.title} ${session.id} ${session.directory}`.toLowerCase().includes(query().toLowerCase()));
  };

  const refresh = async () => {
    if (!api) { setError("Workspace service is not connected. Start the CTG-local workspace server to browse tasks and worktrees."); return; }
    try { setSnapshot(await api.snapshot()); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  onMount(() => {
    const rehydrate = async () => {
      const [projects, active] = await Promise.allSettled([
        context.data.project.sync(),
        context.client.session.active(),
      ]);
      if (projects.status === "rejected") setError(String(projects.reason));
      if (active.status === "fulfilled") setActiveSessions(active.value);
      else setError(String(active.reason));
      try { await syncNativeSessions(); }
      catch (cause) { setError(String(cause)); }
      await refresh();
    };
    void rehydrate();
    // A workspace event is an invalidation hint; always fetch a fresh snapshot.
    const controller = new AbortController();
    const unsubscribe = api.events.on("updated", (event: { location?: { directory: string } }) => {
      const expected = sessionLocation() ?? context.location ?? context.data.location.default();
      if (event.location?.directory === expected.directory) void refresh();
    }, rpcEventOptions(context, controller.signal));
    const stopEvents = context.data.listen(({ details }) => {
      if (details.type === "server.connected") void rehydrate();
    });
    if (unsubscribe) onCleanup(unsubscribe);
    onCleanup(() => { controller.abort(); stopEvents(); });
  });
  const filteredProjects = () => (snapshot()?.projects ?? []).filter((project) =>
    `${project.name ?? ""} ${project.directory}`.toLowerCase().includes(query().toLowerCase()));
  const navigationOptions = () => {
    const state = snapshot();
    if (!state) return [];
    const projects = filteredProjects();
    const projectIDs = new Set(projects.map((project) => project.id));
    const tasks = state.tasks.filter((task) => projectIDs.has(task.projectID));
    const sessions = workspaceSessions();
    return [
      ...projects.map((project) => ({ name: `Project · ${project.name ?? project.directory}`, description: project.directory, value: { type: "project", id: project.id } })),
      ...tasks.map((task) => ({ name: `Task · ${task.title} [${task.status}]`, description: task.directory ?? task.branch ?? task.id, value: { type: "task", id: task.id } })),
      ...sessions.map((session) => ({ name: `Session · ${session.title}${session.attention ? ` [${session.attention} pending]` : ` [${session.status}]`}`, description: session.directory, value: { type: "session", id: session.id } })),
    ];
  };
  const selectNavigation = (option: { value?: { type: string; id: string } } | null) => {
    const selection = option?.value;
    if (selection?.type === "session") void openSession(selection.id);
    else if (selection?.type === "task") {
      const task = snapshot()?.tasks.find((item) => item.id === selection.id);
      const session = snapshot()?.sessions.find((item) => item.taskID === task?.id);
      if (session) void openSession(session.id);
      else setError("This task does not have an associated native session yet.");
    } else if (selection?.type === "project") {
      const project = snapshot()?.projects.find((item) => item.id === selection.id);
      if (project) void worktree(project.id);
    }
  };
  const openSession = async (sessionID: string) => {
    if (!api) { context.ui.router.navigate({ type: "session", sessionID }); return; }
    try { await api.open({ sessionID }); context.ui.router.navigate({ type: "session", sessionID }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const worktree = async (projectID: string) => {
    const name = await context.ui.dialog.prompt({ title: "Create CTG worktree", placeholder: "feature-name" });
    if (!name || !api) return;
    try { const result = await api.createWorktree({ projectID, name }); context.ui.toast.show({ message: `Worktree created: ${context.ui.format.path(result.directory)}`, variant: "success" }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const evidenceSessions = () => workspaceSessions().filter((session) => !activeSession() || session.id === activeSession());
  const refreshEvidence = async (sessionID: string) => {
    if (!api) return;
    const [delivery, review] = await Promise.allSettled([
      api.delivery({ sessionID }),
      api.review({ sessionID }),
    ]);
    setDeliveryEvidence(delivery.status === "fulfilled" ? delivery.value : { error: String(delivery.reason) });
    setReviewEvidence(review.status === "fulfilled" ? review.value : { error: String(review.reason) });
  };
  onMount(() => {
    if (props.view === "evidence" && activeSession()) void refreshEvidence(activeSession()!);
  });
  return <box flexDirection="column" padding={1}>
    <text fg={context.theme.text.feedback.warning.base}>CARTHAGENT · {props.view.toUpperCase()}</text>
    <text fg={context.theme.text.muted}>CTG workspace tasks and native sessions associated with its projects.</text>
    <box flexDirection="row" gap={1}>
      <text fg={context.theme.text.action.secondary.base}>Filter:</text>
      <input placeholder="project name or path" value={query()} onInput={setQuery} />
      <text fg={context.theme.text.action.primary.base} on:click={() => void refresh()}>↻ Refresh</text>
    </box>
    <Show when={error()}><text fg={context.theme.text.feedback.error.base}>{error()}</text></Show>
    <Show when={activeSession()}>{(active) => <box flexDirection="column" marginTop={1}>
      <text fg={context.theme.text.action.primary.base}>Selected native session</text>
      <For each={api ? snapshot()?.sessions.filter((session) => session.id === active()) ?? [] : localSessions().filter((session) => session.id === active())}>{(session) =>
        <box flexDirection="column">
          <text fg={context.theme.text.base}>{session.title}</text>
          <Show when={api}>
            <text fg={context.theme.text.action.secondary.base} on:click={() => void api?.delivery({ sessionID: active() }).then((value: unknown) => context.ui.dialog.alert({ title: "Observed delivery evidence", message: JSON.stringify(value ?? { status: "none" }, null, 2) })).catch((cause: unknown) => setError(String(cause)))}>View delivery evidence</text>
            <text fg={context.theme.text.action.secondary.base} on:click={() => void api?.review({ sessionID: active() }).then((value: unknown) => context.ui.dialog.alert({ title: "Review status", message: JSON.stringify(value ?? { status: "none" }, null, 2) })).catch((cause: unknown) => setError(String(cause)))}>View review status</text>
          </Show>
        </box>}</For>
    </box>}</Show>
    <Show when={snapshot()} fallback={<text fg={context.theme.text.faint}>{error() || "Loading local workspace…"}</text>}>
      <Show when={props.view === "workflow"}>
        <text fg={context.theme.text.action.primary.base}>Execution workflow</text>
        <text fg={context.theme.text.muted}>Projects → tasks → native sessions. Task status and attention come from the workspace service.</text>
        <For each={snapshot()?.tasks ?? []}>{(task) => <text fg={task.attention ? context.theme.text.feedback.warning.base : context.theme.text.base}>{task.attention ? "! " : "· "}{task.title} [{task.status}] · {task.directory ?? task.branch ?? task.id}</text>}</For>
      </Show>
      <Show when={props.view === "architecture"}>
        <text fg={context.theme.text.action.primary.base}>Workspace architecture</text>
        <For each={filteredProjects()}>{(project) => <text fg={context.theme.text.base}>◆ {project.name ?? project.directory} → {snapshot()?.tasks.filter((task) => task.projectID === project.id).length ?? 0} task(s)</text>}</For>
      </Show>
      <Show when={props.view === "evidence"}>
        <text fg={context.theme.text.action.primary.base}>Observed delivery evidence</text>
        <For each={evidenceSessions()}>{(session) => <text fg={context.theme.text.muted}>{session.title} · {session.status} · {session.directory}</text>}</For>
        <Show when={evidenceSessions().length === 0}><text fg={context.theme.text.faint}>No matching workspace session has recorded evidence.</text></Show>
        <Show when={activeSession()}>
          <text fg={context.theme.text.action.secondary.base} on:click={() => void refreshEvidence(activeSession()!)}>↻ Refresh selected session evidence</text>
          <text fg={context.theme.text.action.primary.base}>Delivery receipt</text>
          <text fg={context.theme.text.muted}>{deliveryEvidence() === undefined ? "Loading delivery receipt…" : JSON.stringify(deliveryEvidence(), null, 2)}</text>
          <text fg={context.theme.text.action.primary.base}>Review receipt</text>
          <text fg={context.theme.text.muted}>{reviewEvidence() === undefined ? "Loading review receipt…" : JSON.stringify(reviewEvidence(), null, 2)}</text>
        </Show>
      </Show>
      <select options={navigationOptions()} onSelect={(_index, option) => selectNavigation(option)} focused />
      <For each={filteredProjects()}>{(project) => <box flexDirection="column" marginTop={1}>
        <text fg={context.theme.text.action.primary.base}>◆ {project.name ?? project.directory}</text>
        <text fg={context.theme.text.muted}>{context.ui.format.path(project.directory)}</text>
        <text fg={context.theme.text.action.secondary.base} on:click={() => void worktree(project.id)}>+ Create worktree</text>
        <For each={snapshot()?.tasks.filter((task) => task.projectID === project.id)}>{(task) => <box flexDirection="column" paddingLeft={2}>
          <text fg={task.attention ? context.theme.text.feedback.warning.base : context.theme.text.base}>{task.attention ? "! " : "· "}{task.title}  [{task.status}]</text>
         <For each={snapshot()?.sessions.filter((session) => session.taskID === task.id)}>{(session) =>
            <text fg={context.theme.text.muted}>  ↳ {session.title} · {session.status}</text>}</For>
        </box>}</For>
      </box>}</For>
    </Show>
    <Show when={snapshot()}>
      <text fg={context.theme.text.action.primary.base}>Workspace native sessions</text>
      <For each={workspaceSessions()}>{(session) => <text fg={session.attention ? context.theme.text.feedback.warning.base : context.theme.text.action.secondary.base} on:click={() => void openSession(session.id)}>{session.attention ? "! " : "· "}{session.title} [{session.attention ? `${session.attention} pending` : session.status}] · {session.directory}</text>}</For>
    </Show>
    <Show when={!snapshot()}>
      <text fg={context.theme.text.action.primary.base}>Local OpenCode sessions</text>
      <For each={localSessions().filter((session) => !query() || `${session.title ?? ""} ${session.id} ${session.location.directory}`.toLowerCase().includes(query().toLowerCase()))}>{(session) => <text fg={context.theme.text.action.secondary.base} on:click={() => context.ui.router.navigate({ type: "session", sessionID: session.id })}>· {session.title ?? session.id} [{context.data.session.status(session.id)}]</text>}</For>
    </Show>
    <text fg={context.theme.text.faint}>Keyboard: use /ctg-open to search sessions; /ctg-worktree creates a worktree; /ctg-task starts a task.</text>
  </box>;
}
