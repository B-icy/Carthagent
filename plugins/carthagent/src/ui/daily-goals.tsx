/** @jsxImportSource @opentui/solid */
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { usePlugin } from "@opencode/plugin/tui";
import { dailyGoalsClient } from "./client.js";
import type { DailyGoalsSnapshot } from "../daily-goals-rpc.js";
import { SAMPLE_GOALS, goalBar, goalProgressLabel, goalTierLabel, goalsReset, signInNeeded } from "../daily-goals.mjs";
import { voyagesEventAction } from "./voyages-state.mjs";

const errorText = (code: string) => signInNeeded(code) ? "Sign in to Carthagent Cloud to track daily goals (press l). Verified Ship tasks and everyday coding count automatically."
  : /timeout|request_failed/.test(code) ? "Could not reach Voyages. Press r to retry."
  : code === "voyages_disabled" || code === "voyages_unavailable" ? "Voyages is not available right now."
  : "Could not load daily goals. Press r to retry.";

/** Three simple daily goals, counted automatically from your ctg sessions. */
export function DailyGoalsPage(props: { sessionID?: string }) {
  const context = usePlugin();
  const location = () => (props.sessionID ? context.data.session.get(props.sessionID)?.location : undefined) ?? context.location ?? context.data.location.default();
  const api = dailyGoalsClient(context, location);
  const [snapshot, setSnapshot] = createSignal<DailyGoalsSnapshot>();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [signedOut, setSignedOut] = createSignal(false);
  const [clock, setClock] = createSignal(Date.now());
  let generation = 0;
  const refresh = async () => {
    const current = ++generation;
    setBusy(true); setError(""); setSignedOut(false);
    try {
      const next = await api.snapshot();
      if (current === generation) setSnapshot(next);
    } catch (failure) {
      if (current !== generation) return;
      const code = (failure as { type?: string; data?: { code?: unknown } })?.type === "dailyGoalsError" ? String((failure as { data: { code: unknown } }).data.code) : "request_failed";
      setSignedOut(signInNeeded(code));
      setError(errorText(code));
    } finally { if (current === generation) setBusy(false); }
  };
  const enabled = () => !busy() && context.keymap.mode.current() === "base";
  const coding = () => context.ui.router.navigate(props.sessionID ? { type: "session", sessionID: props.sessionID } : { type: "home" });
  const character = () => context.ui.router.navigate({ type: "plugin", name: "voyages", data: { ...(props.sessionID ? { sessionID: props.sessionID } : {}), section: "profile" } });
  const signIn = () => { context.keymap.dispatch("provider.connect"); };
  context.keymap.layer(() => ({ priority: 30, commands: [
    { bind: "escape", title: "Back", run: coding },
    { bind: "l", title: "Sign in", enabled: () => enabled() && signedOut(), run: signIn },
    { bind: "s", title: "Character", enabled, run: character },
    { bind: "r", title: "Refresh goals", enabled, run: () => { void refresh(); } },
  ] }));
  onMount(() => {
    void refresh();
    const stop = context.data.listen(({ details }) => { if (voyagesEventAction(details, location()) !== "ignore") void refresh(); });
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    onCleanup(() => { generation++; stop(); clearInterval(timer); });
  });
  const done = () => snapshot()?.goals.filter(g => g.completed).length ?? 0;
  return <box flexDirection="column" flexGrow={1} minHeight={0} paddingX={2} paddingY={1} overflow="hidden" backgroundColor={context.theme.background.base}>
    <box flexDirection="row" flexShrink={0}>
      <text flexShrink={0} fg={context.theme.text.base} attributes={TextAttributes.BOLD}>Daily goals</text>
      <box flexGrow={1} />
      <Show when={snapshot()}>{s => <text fg={context.theme.text.muted}>{s().coins} coins · Level {s().level} · {goalsReset(s().endsAt, clock())}</text>}</Show>
    </box>
    <text flexShrink={0} fg={context.theme.text.muted}>Counted automatically from your ctg sessions. Each goal pays once a day; ★ goals are bigger and pay more.</text>
    <box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      <Show when={busy() && !snapshot()}><text flexShrink={0} marginTop={1} fg={context.theme.text.muted}>Loading…</text></Show>
      <Show when={error()}><text flexShrink={0} marginTop={1} fg={context.theme.text.feedback.warning.base}>{error()}</text></Show>
      <For each={snapshot()?.goals ?? []}>{goal => <box flexDirection="column" flexShrink={0} marginTop={1} paddingX={2} backgroundColor={context.theme.background.raised.base}>
        <box flexDirection="row" flexShrink={0}>
          <text flexShrink={0} fg={goal.completed ? context.theme.text.feedback.success.base : context.theme.text.base} attributes={TextAttributes.BOLD}>{goal.completed ? "✓ " : "○ "}{goal.title}</text>
          <Show when={goalTierLabel(goal)}><text flexShrink={0} fg={goal.tier === "stretch" ? context.theme.text.feedback.warning.base : context.theme.text.action.primary.base} attributes={TextAttributes.BOLD}>{`  ★ ${goalTierLabel(goal)}`}</text></Show>
          <box flexGrow={1} />
          <text flexShrink={0} fg={context.theme.text.muted}>+{goal.coins} coins · +{goal.xp} XP</text>
        </box>
        <text flexShrink={0} fg={goal.completed ? context.theme.text.feedback.success.base : context.theme.text.action.primary.base}>{goalBar(goal)} {goal.completed ? "Done" : goalProgressLabel(goal)}</text>
      </box>}</For>
      <Show when={signedOut() && !snapshot()}>
        <text flexShrink={0} marginTop={1} fg={context.theme.text.muted}>Example goals (yours appear after you sign in):</text>
        <For each={SAMPLE_GOALS}>{goal => <box flexDirection="row" flexShrink={0} marginTop={1} paddingX={2} backgroundColor={context.theme.background.raised.base}>
          <text flexShrink={0} fg={context.theme.text.muted}>○ {goal.title}</text>
          <box flexGrow={1} />
          <text flexShrink={0} fg={context.theme.text.muted}>+{goal.coins} coins · +{goal.xp} XP</text>
        </box>}</For>
      </Show>
      <Show when={snapshot() && done() === snapshot()!.goals.length && done() > 0}><text flexShrink={0} marginTop={1} fg={context.theme.text.feedback.success.base}>All done for today. New goals at the reset.</text></Show>
    </box>
    <box flexDirection="row" flexShrink={0} gap={2} paddingTop={1}>
      <Show when={signedOut()}><text fg={context.theme.text.action.primary.base} attributes={TextAttributes.BOLD} onMouseUp={signIn}>l Sign in</text></Show>
      <text fg={context.theme.text.action.secondary.base} onMouseUp={character}>s Character</text>
      <text fg={context.theme.text.action.secondary.base} onMouseUp={() => { if (enabled()) void refresh(); }}>r Refresh</text>
      <text fg={context.theme.text.action.secondary.base} onMouseUp={coding}>Esc Coding</text>
    </box>
  </box>;
}
