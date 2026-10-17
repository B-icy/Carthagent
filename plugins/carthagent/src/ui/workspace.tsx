/** @jsxImportSource @opentui/solid */
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { usePlugin } from "@opencode/plugin/tui";
import { pullRequestClient, rpcEventOptions, workspaceClient, type PullRequestRecord, type WorkspaceDelivery, type WorkspaceSnapshot } from "./client.js";
import { createLatestRequestGate, onWorkspaceUpdated } from "./workspace-live.js";

function sessionAttention(context: ReturnType<typeof usePlugin>, sessionID: string) {
  return (context.data.session.permission.list(sessionID)?.length ?? 0) + (context.data.session.form.list(sessionID)?.length ?? 0);
}

export function WorkspacePage(props: { view: string; refreshKey?: string; sessionID?: string }) {
  const context = usePlugin();
  const [snapshot, setSnapshot] = createSignal<WorkspaceSnapshot>();
  const [activeSessions, setActiveSessions] = createSignal<Record<string, { type: "running" }>>({});
  const [deliveryEvidence, setDeliveryEvidence] = createSignal<WorkspaceDelivery>();
  const [reviewEvidence, setReviewEvidence] = createSignal<unknown>();
  const [inventorySessions, setInventorySessions] = createSignal<ReturnType<typeof context.data.session.list>>([]);
  const [query, setQuery] = createSignal("");
  const [error, setError] = createSignal("");
  const [rpcConnected, setRpcConnected] = createSignal(true);
  const [pullRequests, setPullRequests] = createSignal<Record<string, PullRequestRecord[]>>({});
  const snapshotRequests = createLatestRequestGate();
  const evidenceRequests = createLatestRequestGate();
  const currentSessionID = () => {
    const currentRoute = context.ui.router.current();
    return props.sessionID ?? (currentRoute.type === "session" ? currentRoute.sessionID : currentRoute.type === "plugin" && currentRoute.name === "carthagent" && typeof currentRoute.data?.sessionID === "string" ? currentRoute.data.sessionID : undefined);
  };
  const sessionLocation = () => currentSessionID() ? context.data.session.get(currentSessionID()!)?.location : undefined;
  const api = workspaceClient(context, sessionLocation);
  const currentLocation = () => sessionLocation() ?? context.location ?? context.data.location.default();
  const activeSession = () => {
    const activeRoute = context.ui.router.current();
    return activeRoute.type === "plugin" ? activeRoute.data?.sessionID ?? props.sessionID : activeRoute.type === "session" ? activeRoute.sessionID : props.sessionID;
  };
  const localSessions = () => inventorySessions().filter((session) => !session.parentID);
  const syncNativeSessions = async (isCurrent: () => boolean, signal: AbortSignal) => {
    const all = [] as ReturnType<typeof context.data.session.list>;
    let cursor: string | undefined;
    do {
      const page = await context.client.session.list({ limit: 100, order: "desc", ...(cursor ? { cursor } : {}) }, { signal });
      if (!isCurrent()) return;
      all.push(...page.data);
      cursor = page.cursor.next ?? undefined;
    } while (cursor);
    if (!isCurrent()) return;
    const sessions = all.filter((session) => !session.parentID);
    for (const session of sessions) {
      if (!isCurrent()) return;
      await Promise.allSettled([
        context.data.session.sync(session.id),
        context.data.session.permission.sync(session.id),
        context.data.session.form.sync(session.id, session.location),
      ]);
    }
    if (isCurrent()) setInventorySessions(all);
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

  const refresh = async (signal?: AbortSignal) => {
    const request = snapshotRequests.begin();
    if (!api) { if (request.isCurrent()) setError("Workspace service is not connected. Start the CTG-local workspace server to browse tasks and worktrees."); return; }
    const requestSignal = signal ? AbortSignal.any([signal, request.signal]) : request.signal;
    try {
      const result = await api.snapshot(undefined, requestSignal);
      if (!request.isCurrent()) return;
      setSnapshot(result);
      setRpcConnected(true);
      setError("");
    } catch (cause) {
      if (request.isCurrent()) {
        setRpcConnected(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  };
  onMount(() => {
    let generation = 0;
    let observedDirectory = currentLocation().directory;
    let nativeAbort: AbortController | undefined;
    let rehydrateAbort: AbortController | undefined;
    let rpcAbort: AbortController | undefined;
    let stopRpc: (() => void) | undefined;
    const subscribeRpc = () => {
      rpcAbort?.abort();
      stopRpc?.();
      if (!api) return;
      rpcAbort = new AbortController();
      stopRpc = onWorkspaceUpdated(api.events, () => currentLocation().directory, () => {
        snapshotRequests.invalidate();
        evidenceRequests.invalidate();
        void refresh();
      }, rpcEventOptions(context, rpcAbort.signal));
    };
    const queueRehydrate = (() => {
      let queued = false;
      return () => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => { queued = false; void rehydrate(); });
      };
    })();
    const rehydrate = async () => {
      const currentGeneration = ++generation;
      snapshotRequests.invalidate();
      evidenceRequests.invalidate();
      rehydrateAbort?.abort();
      rehydrateAbort = new AbortController();
      nativeAbort?.abort();
      nativeAbort = rehydrateAbort;
      const isCurrent = () => currentGeneration === generation && !rehydrateAbort?.signal.aborted;
      const [projects, active] = await Promise.allSettled([
        context.data.project.sync(),
        context.client.session.active({ signal: rehydrateAbort.signal }),
      ]);
      if (!isCurrent()) return;
      if (projects.status === "rejected") setError(String(projects.reason));
      if (active.status === "fulfilled") setActiveSessions(active.value);
      else setError(String(active.reason));
      try { await syncNativeSessions(isCurrent, nativeAbort.signal); }
      catch (cause) { if (isCurrent()) setError(String(cause)); }
      if (!isCurrent()) return;
      await refresh(rehydrateAbort.signal);
      if (!isCurrent()) return;
      if (props.view === "evidence" || props.view === "workflow" || props.view === "architecture") {
        const selected = activeSession();
        if (selected) await refreshEvidence(selected);
      }
    };
    const refreshLocationBinding = () => {
      const directory = currentLocation().directory;
      if (directory === observedDirectory) return false;
      observedDirectory = directory;
      generation++;
      snapshotRequests.invalidate();
      evidenceRequests.invalidate();
      rehydrateAbort?.abort();
      nativeAbort?.abort();
      rpcAbort?.abort();
      stopRpc?.();
      subscribeRpc();
      void rehydrate();
      return true;
    };
    const invalidateFromHostEvent = (details: unknown) => {
      const event = details as { type: string; data?: { sessionID?: string; form?: { sessionID?: string; info?: { sessionID?: string } } }; location?: { directory: string } };
      const sessionID = event.data?.sessionID ?? event.data?.form?.sessionID ?? event.data?.form?.info?.sessionID;
      if (sessionID) {
        context.data.session.invalidate(sessionID);
        context.data.session.permission.invalidate(sessionID);
        context.data.session.form.invalidate(sessionID, event.location ?? currentLocation());
      }
      if (["session.created", "session.deleted", "session.updated", "session.status", "session.idle", "session.execution.started", "session.execution.succeeded", "session.execution.failed", "session.execution.interrupted", "permission.asked", "permission.replied", "form.created", "form.updated", "form.deleted", "form.replied", "form.cancelled"].includes(event.type)) {
        queueRehydrate();
      }
    };
    void rehydrate();
    subscribeRpc();
    const stopEvents = context.data.listen(({ details }) => {
      if (refreshLocationBinding()) return;
      if (details.type === "server.connected") {
        setRpcConnected(true);
        subscribeRpc();
        void rehydrate();
      } else {
        if ((details as { type: string }).type === "server.disconnected") {
          setRpcConnected(false);
          generation++;
          snapshotRequests.invalidate();
          evidenceRequests.invalidate();
          nativeAbort?.abort();
          rpcAbort?.abort();
          stopRpc?.();
        } else invalidateFromHostEvent(details);
      }
    });
    onCleanup(() => { generation++; snapshotRequests.invalidate(); evidenceRequests.invalidate(); rehydrateAbort?.abort(); nativeAbort?.abort(); rpcAbort?.abort(); stopRpc?.(); stopEvents(); });
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
  const taskForSession = (sessionID: string) => snapshot()?.sessions.find((session) => session.id === sessionID)?.taskID;
  const loadPullRequests = async (sessionID: string) => {
    const taskID = taskForSession(sessionID);
    if (!taskID) { setError("This session is not attached to a CTG task."); return; }
    try {
      const result = await pullRequestClient(context, sessionLocation).list({ sessionID, taskID });
      setPullRequests((current) => ({ ...current, [taskID]: result.pullRequests }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const associatePullRequest = async (sessionID: string) => {
    const taskID = taskForSession(sessionID);
    if (!taskID) { setError("Associate a pull request from a session attached to a CTG task."); return; }
    const answer = await context.ui.dialog.prompt({ title: "Associate GitHub pull request", placeholder: "Pull request number" });
    if (!answer) return;
    const number = Number(answer.trim());
    if (!Number.isSafeInteger(number) || number < 1) { setError("Enter a positive pull request number."); return; }
    try {
      const result = await pullRequestClient(context, sessionLocation).associate({ sessionID, taskID, number });
      setPullRequests((current) => ({ ...current, [taskID]: [...(current[taskID] ?? []).filter((item) => item.number !== number), result.pullRequest] }));
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const refreshPullRequest = async (sessionID: string, taskID: string, number: number) => {
    try {
      const result = await pullRequestClient(context, sessionLocation).refresh({ sessionID, taskID, number });
      setPullRequests((current) => ({ ...current, [taskID]: (current[taskID] ?? []).map((item) => item.number === number ? result.pullRequest : item) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const refreshEvidence = async (sessionID: string) => {
    if (!api) return;
    const request = evidenceRequests.begin();
    const signal = request.signal;
    const [delivery, review] = await Promise.allSettled([
      api.delivery({ sessionID }, signal),
      api.review({ sessionID }, signal),
    ]);
    if (!request.isCurrent() || activeSession() !== sessionID) return;
    setDeliveryEvidence(delivery.status === "fulfilled" ? delivery.value : { status: "invalid", error: String(delivery.reason) });
    setReviewEvidence(review.status === "fulfilled" ? review.value : { error: String(review.reason) });
  };
  onMount(() => {
    if (["evidence", "workflow", "architecture"].includes(props.view) && activeSession()) void refreshEvidence(activeSession()!);
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
    <Show when={!rpcConnected()}><text fg={context.theme.text.feedback.warning.base}>Workspace RPC disconnected · cached view may be stale; waiting for native reconnect</text></Show>
    <Show when={activeSession()}>{(active) => <box flexDirection="column" marginTop={1}>
      <text fg={context.theme.text.action.primary.base}>Selected native session</text>
      <For each={api ? snapshot()?.sessions.filter((session) => session.id === active()) ?? [] : localSessions().filter((session) => session.id === active())}>{(session) =>
        <box flexDirection="column">
          <text fg={context.theme.text.base}>{session.title}</text>
          <Show when={api}>
            <text fg={context.theme.text.action.secondary.base} on:click={() => void api?.delivery({ sessionID: active() }).then((value: unknown) => context.ui.dialog.alert({ title: "Observed delivery evidence", message: JSON.stringify(value ?? { status: "none" }, null, 2) })).catch((cause: unknown) => setError(String(cause)))}>View delivery evidence</text>
            <text fg={context.theme.text.action.secondary.base} on:click={() => void api?.review({ sessionID: active() }).then((value) => context.ui.dialog.alert({ title: "Review status", message: `${value.status}${value.summary ? `\n\n${value.summary}` : ""}` })).catch((cause: unknown) => setError(String(cause)))}>View review status</text>
          </Show>
        </box>}</For>
      <Show when={taskForSession(active())}>
        <text fg={context.theme.text.action.primary.base}>Task pull requests · GitHub is queried only by explicit actions</text>
        <text fg={context.theme.text.action.secondary.base} on:click={() => void loadPullRequests(active())}>Load cached pull requests</text>
        <text fg={context.theme.text.action.secondary.base} on:click={() => void associatePullRequest(active())}>+ Associate pull request…</text>
        <For each={pullRequests()[taskForSession(active())!] ?? []}>{(pr) => <box flexDirection="column">
          <text fg={context.theme.text.base}>#{pr.number} · {pr.state}{pr.draft ? " · draft" : ""} · checks {pr.checks} · review {pr.review} · {pr.source}</text>
          <text fg={context.theme.text.muted}>{pr.headRef} → {pr.baseRef} · {pr.head.slice(0, 10)} · updated {pr.updatedAt}</text>
          <text fg={context.theme.text.action.secondary.base} on:click={() => void refreshPullRequest(active(), pr.taskID, pr.number)}>↻ Refresh #{pr.number} from GitHub</text>
        </box>}</For>
      </Show>
    </box>}</Show>
    <Show when={snapshot()} fallback={<text fg={context.theme.text.faint}>{error() || "Loading local workspace…"}</text>}>
      <Show when={props.view === "workflow"}>
        <text fg={context.theme.text.action.primary.base}>Authoritative delivery workflow · {deliveryEvidence()?.status ?? "select a session"}</text>
        <Show when={deliveryEvidence()?.workflow} fallback={<text fg={context.theme.text.faint}>Select a session with a delivery report to load workflow nodes, edges, and step receipts.</text>}>
          <text fg={context.theme.text.muted}>{deliveryEvidence()?.workflow?.semantics}</text>
          <For each={deliveryEvidence()?.workflow?.nodes ?? []}>{(node) => <text fg={node.status === "failed" || node.status === "blocked" ? context.theme.text.feedback.error.base : node.status === "complete" || node.status === "passed" ? context.theme.text.feedback.success.base : context.theme.text.base}>[{node.status}] {node.title} · {node.type}{node.step ? ` · step ${node.step}` : ""} · checks: {node.checks.join(", ") || "none"}</text>}</For>
          <For each={deliveryEvidence()?.workflow?.edges ?? []}>{(edge) => <text fg={context.theme.text.muted}>{edge.from} → {edge.to} · {edge.label ?? edge.kind}{edge.when ? ` · when ${edge.when}` : ""}</text>}</For>
        </Show>
        <text fg={context.theme.text.action.secondary.base} on:click={() => activeSession() && void refreshEvidence(activeSession()!)}>↻ Refresh delivery workflow</text>
      </Show>
      <Show when={props.view === "architecture"}>
        <text fg={context.theme.text.action.primary.base}>Delivery architecture · {deliveryEvidence()?.status ?? "select a session"}</text>
        <Show when={deliveryEvidence()?.architecture} fallback={<text fg={context.theme.text.faint}>Select a session with a delivery report to load authored architecture nodes, edges, and ports.</text>}>
          <For each={deliveryEvidence()?.architecture?.nodes ?? []}>{(node) => <text fg={context.theme.text.base}>◆ {node.title} · {node.type ?? "component"}{node.layer ? ` · layer ${node.layer}` : ""}{node.status ? ` · ${node.status}` : ""}</text>}</For>
          <For each={deliveryEvidence()?.architecture?.edges ?? []}>{(edge) => <text fg={context.theme.text.muted}>{edge.from} → {edge.to} · {edge.label ?? edge.kind}</text>}</For>
          <For each={deliveryEvidence()?.architecture?.ports ?? []}>{(port) => <text fg={context.theme.text.action.secondary.base}>⇄ {port.id} · {port.owner} via {port.adapter} · root {port.compositionRoot}{port.integrationAssertion ? ` · verifies ${port.integrationAssertion}` : ""}</text>}</For>
        </Show>
        <text fg={context.theme.text.action.secondary.base} on:click={() => activeSession() && void refreshEvidence(activeSession()!)}>↻ Refresh delivery architecture</text>
      </Show>
      <Show when={props.view === "evidence"}>
        <text fg={context.theme.text.action.primary.base}>Observed delivery evidence</text>
        <For each={evidenceSessions()}>{(session) => <text fg={context.theme.text.muted}>{session.title} · {session.status} · {session.directory}</text>}</For>
        <Show when={evidenceSessions().length === 0}><text fg={context.theme.text.faint}>No matching workspace session has recorded evidence.</text></Show>
        <Show when={activeSession()}>
          <text fg={context.theme.text.action.secondary.base} on:click={() => void refreshEvidence(activeSession()!)}>↻ Refresh selected session evidence</text>
          <text fg={context.theme.text.action.primary.base}>Delivery receipt</text>
          <Show when={deliveryEvidence()} fallback={<text fg={context.theme.text.faint}>Loading delivery receipt…</text>}>
            <text fg={context.theme.text.base}>Status: {deliveryEvidence()?.status} · {deliveryEvidence()?.freshness ?? "freshness unavailable"} · revision {deliveryEvidence()?.revision ?? "—"} · run {deliveryEvidence()?.runId ?? "—"}</text>
            <Show when={deliveryEvidence()?.plan}>{(plan) => <box flexDirection="column">
              <text fg={context.theme.text.action.primary.base}>Goal: {plan().goal}</text>
              <For each={plan().steps}>{(step) => <text fg={step.status === "completed" ? context.theme.text.feedback.success.base : context.theme.text.base}>[{step.status}] {step.id} · {step.title}{step.dependsOn.length ? ` · after ${step.dependsOn.join(", ")}` : ""}</text>}</For>
              <For each={deliveryEvidence()?.evidence ?? []}>{(item) => <text fg={item.status === "fresh" ? context.theme.text.feedback.success.base : item.status === "failed" || item.status === "stale" ? context.theme.text.feedback.error.base : context.theme.text.feedback.warning.base}>Receipt {item.id}: {item.status}{item.code !== undefined ? ` · exit ${item.code}` : ""}{item.filename ? ` · ${item.filename}` : ""}</text>}</For>
            </box>}</Show>
          </Show>
          <text fg={context.theme.text.action.primary.base}>Review receipt</text>
          <Show when={reviewEvidence()} fallback={<text fg={context.theme.text.faint}>Loading review receipt…</text>}>
            <text fg={context.theme.text.muted}>{String((reviewEvidence() as { status?: string; summary?: string } | undefined)?.status ?? "unavailable")}{(reviewEvidence() as { summary?: string } | undefined)?.summary ? ` · ${(reviewEvidence() as { summary: string }).summary}` : ""}</text>
          </Show>
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
