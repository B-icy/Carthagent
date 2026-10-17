/** @jsxImportSource @opentui/solid */
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { usePlugin } from "@opencode/plugin/tui";
import { rpcEventOptions, workspaceClient, type WorkspaceSnapshot } from "./client.js";

export function WorkspacePage(props: { view: string; refreshKey?: string; sessionID?: string }) {
  const context = usePlugin();
  const [snapshot, setSnapshot] = createSignal<WorkspaceSnapshot>();
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
  const localSessions = () => context.data.session.list().filter((session) => !session.parentID && (!query() || `${session.title ?? ""} ${session.id}`.toLowerCase().includes(query().toLowerCase())));

  const refresh = async () => {
    if (!api) { setError("Workspace service is not connected. Start the CTG-local workspace server to browse tasks and worktrees."); return; }
    try { setSnapshot(await api.snapshot()); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  onMount(() => {
    void refresh();
    // A workspace event is an invalidation hint; always fetch a fresh snapshot.
    const controller = new AbortController();
    const unsubscribe = api.events.on("updated", (event: { location?: { directory: string } }) => {
      const expected = sessionLocation() ?? context.location ?? context.data.location.default();
      if (event.location?.directory === expected.directory) void refresh();
    }, rpcEventOptions(context, controller.signal));
    const stopEvents = context.data.listen(({ details }) => {
      if (details.type === "server.connected") void refresh();
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
    const taskIDs = new Set(tasks.map((task) => task.id));
    const sessions = state.sessions.filter((session) => session.taskID ? taskIDs.has(session.taskID) : projectIDs.has(session.projectID ?? ""));
    return [
      ...projects.map((project) => ({ name: `Project · ${project.name ?? project.directory}`, description: project.directory, value: { type: "project", id: project.id } })),
      ...tasks.map((task) => ({ name: `Task · ${task.title} [${task.status}]`, description: task.directory ?? task.branch ?? task.id, value: { type: "task", id: task.id } })),
      ...sessions.map((session) => ({ name: `Session · ${session.title} [${session.status}]`, description: session.directory, value: { type: "session", id: session.id } })),
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

  return <box flexDirection="column" padding={1}>
    <text fg={context.theme.hue.accent[400]}>CARTHAGENT · {props.view.toUpperCase()}</text>
    <text fg={context.theme.text.muted}>Projects, tasks, and sessions from the CTG workspace service only.</text>
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
    <Show when={!snapshot()}>
      <text fg={context.theme.text.action.primary.base}>Local OpenCode sessions</text>
      <For each={localSessions()}>{(session) => <text fg={context.theme.text.action.secondary.base} on:click={() => context.ui.router.navigate({ type: "session", sessionID: session.id })}>· {session.title ?? session.id} [{context.data.session.status(session.id)}]</text>}</For>
    </Show>
    <text fg={context.theme.text.faint}>Keyboard: use /ctg-open to search sessions; /ctg-worktree creates a worktree; /ctg-task starts a task.</text>
  </box>;
}
