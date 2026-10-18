/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { Show } from "solid-js";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { framePrompt } from "../../../lib/tui/framing.mjs";
import { carthagentConfigPath, loadCarthagentConfig, resolveReviewMode, saveCarthagentConfig } from "../../../lib/review.mjs";
import { COMMANDS, NATIVE_COMMAND_COLLISIONS } from "./ui/commands.js";
import { Workspace, rpcEventOptions, sessionControls, workspaceClient, shipClient, archiveClient, cloudAccountText, cloudUsageText, archiveItemText } from "./ui/client.js";
import { findNativeResumeSession } from "./ui/resume-session.mjs";
import { cliConfigDirectory, cliConfigPath, readCliConfig, writeNativeTheme } from "./ui/host-state.js";
import { WorkspacePage } from "./ui/workspace.js";
import { provisionNativeThemes } from "./ui/theme-provision.mjs";

const THEMES = ["carthage", "opencode", "tokyonight", "nebula", "ember", "forest", "mono", "obsidian", "midnight", "solarized-dark", "nord", "contrast-dark", "okabe-dark", "paper", "daylight", "solarized-light", "contrast-light", "okabe-light", "solarized", "okabe", "contrast", "system"];
const OPENCODE_BUILTIN_THEMES = new Set(["opencode", "tokyonight"]);

export default Plugin.define({
  id: "carthagent.tui",
  setup(context) {
    const unregister = context.ui.router.register({ name: "carthagent", render: ({ data }) => <WorkspacePage view={String(data?.view ?? "workspace")} refreshKey={String(data?.refresh ?? "")} sessionID={typeof data?.sessionID === "string" ? data.sessionID : undefined} /> });
    const cleanups = [unregister];
    const lifecycle = new AbortController();
    cleanups.push(() => lifecycle.abort());
    const workspaceEvents = context.client.rpc(Workspace);
    cleanups.push(workspaceEvents.events.on("updated", (event) => {
      // Promise RPC exposes the server event envelope (including location)
      // separately from the declared event data ({ revision }).
      const route = context.ui.router.current();
      const sessionID = route.type === "session" ? route.sessionID : route.type === "plugin" && route.name === "carthagent" && typeof route.data?.sessionID === "string" ? route.data.sessionID : undefined;
      const expected = (sessionID ? context.data.session.get(sessionID)?.location : undefined) ?? context.location ?? context.data.location.default();
      if (event.location?.directory === expected.directory) context.data.project.invalidate();
    }, rpcEventOptions(context, lifecycle.signal)));
    context.keymap.layer(() => ({
      mode: "global",
      priority: 20,
      commands: [
        ...COMMANDS.filter((item) => !NATIVE_COMMAND_COLLISIONS.includes(item.name as typeof NATIVE_COMMAND_COLLISIONS[number]))
        .map((item) => ({
          id: `carthagent.${item.id}`,
          title: `/${item.name}${item.args ? ` ${item.args}` : ""}`,
          description: item.description,
          group: "Carthagent",
          palette: true as const,
          slash: { name: item.name, ...(item.aliases ? { aliases: item.aliases } : {}), ...(item.args || item.submitSlash ? { arguments: true as const } : {}) },
          run: (input?: string) => {
            const report = (error: unknown) => context.ui.toast.show({ message: error instanceof Error ? error.message : String(error), variant: "error" });
            if (item.id === "restart" || item.id === "abort") {
              void dispatch(item.id, input ?? "").catch(report);
              return false;
            }
            return dispatch(item.id, input ?? "").then(() => undefined).catch(report);
          },
        })),
      ],
    }));

    async function dispatch(id: string, input: string) {
      const route = context.ui.router.current();
      const sessionID = route.type === "session" ? route.sessionID : route.type === "plugin" && route.name === "carthagent" && typeof route.data?.sessionID === "string" ? route.data.sessionID : undefined;
      const activeSession = sessionID ? context.data.session.get(sessionID) : undefined;
      const location = activeSession?.location ?? context.location ?? context.data.location.default();
      const arg = input.trim();
      const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info") => context.ui.toast.show({ message, variant });
      const selectedModel = context.ui.model.current();
      const sessionApi = sessionControls(context, location);
      switch (id) {
        case "help": case "ctg-help":
          await context.ui.dialog.alert({ title: "Carthagent commands", message: COMMANDS.map((command) => `/${command.name}${command.args ? ` ${command.args}` : ""}${command.aliases?.length ? ` (${command.aliases.map((alias) => `/${alias}`).join(", ")})` : ""} — ${command.description}`).join("\n") + "\n\nCtrl+R sessions · Ctrl+T settings · Ctrl+N new session are native OpenCode actions." });
          return;
        case "resume": {
          const query = arg.toLowerCase();
          const pageSize = 100;
          const match = query ? await findNativeResumeSession({ query: arg, directory: location.directory, client: context.client }) : undefined;
          if (match) { context.ui.router.navigate({ type: "session", sessionID: match.id }); return; }
          if (query) {
            const archived = await archiveClient(context, location).search({ query: arg, limit: 1 }) as { total: number };
            if (archived.total > 0) { toast(`“${arg}” matched ${archived.total} legacy archive result(s); archives are read-only and cannot be resumed. Use /archive search ${arg}.`, "warning"); return; }
            toast(`No native session matches “${arg}” in ${context.ui.format.path(location.directory)}.`, "warning");
            return;
          }
          let cursor: string | undefined;
          const sessions: Array<{ id: string; title?: string; parentID?: string; time: { updated: number } }> = [];
          do {
            const page = await context.client.session.list({ limit: pageSize, order: "desc", directory: location.directory, ...(cursor ? { cursor } : {}) });
            sessions.push(...page.data.filter((session) => !session.parentID));
            cursor = page.cursor.next ?? undefined;
          } while (cursor);
          const selected = await context.ui.dialog.select({ title: `Resume native session · ${sessions.length} loaded`, options: sessions.map((session) => ({ title: session.title ?? session.id, value: session.id, description: `${new Date(session.time.updated).toLocaleString()} · ${session.id}` })) });
          if (selected) context.ui.router.navigate({ type: "session", sessionID: selected });
          return;
        }
        case "ctg-task": {
          if (!arg) { toast("Usage: /ctg-task <task description>.", "warning"); return; }
          const result = await workspaceClient(context, location).createTask({ task: arg }, AbortSignal.timeout(60_000));
          context.ui.router.navigate({ type: "session", sessionID: result.sessionID });
          toast(`Task created in ${context.ui.format.path(result.directory)}.`, "success");
          return;
        }
        case "restart":
          if (!sessionID) { toast("/restart requires an open session; it interrupts only the selected session and never restarts the shared service.", "warning"); return; }
          await context.client.session.interrupt({ sessionID, resume: false });
          toast("Selected session interrupted; its transcript is preserved.", "success");
          return;
        case "theme": {
          const theme = arg.toLowerCase();
          const cliPath = cliConfigPath();
          const currentConfig = await readCliConfig(cliPath);
          const currentTheme = typeof currentConfig.theme === "string" ? currentConfig.theme : currentConfig.theme?.name;
          if (theme) {
            if (!THEMES.includes(theme)) { toast(`Unknown theme “${theme}”. Available compatibility names: ${THEMES.join(", ")}.`, "warning"); return; }
            const provisioned: { directory?: string; installed: string[] } = OPENCODE_BUILTIN_THEMES.has(theme) ? { installed: [] } : await provisionNativeThemes(cliConfigDirectory(), [theme]);
            if (provisioned.installed.length) {
              toast(`Installed native theme “${theme}” in ${provisioned.directory ?? cliConfigDirectory()}. OpenCode discovers new theme files at startup; restart the TUI, then run /theme ${theme} again to select it.`, "warning");
              return;
            }
            await writeNativeTheme(cliConfigPath(), theme);
            toast(`Theme “${theme}” saved to native OpenCode cli.json. OpenCode reloads valid theme selections while the TUI is running.`, "success");
            return;
          }
          const selected = await context.ui.dialog.select({ title: "OpenCode themes", current: currentTheme, options: THEMES.map((name) => ({ title: name, value: name, description: name === "carthage" ? "Carthagent purple field, gold accent" : "OpenCode theme" })) });
          if (selected) {
            const provisioned: { directory?: string; installed: string[] } = OPENCODE_BUILTIN_THEMES.has(selected) ? { installed: [] } : await provisionNativeThemes(cliConfigDirectory(), [selected]);
            if (provisioned.installed.length) {
              toast(`Installed native theme “${selected}” in ${provisioned.directory ?? cliConfigDirectory()}. OpenCode discovers new theme files at startup; restart the TUI, then select it again.`, "warning");
              return;
            }
            await writeNativeTheme(cliPath, selected);
            toast(`Theme “${selected}” saved to native OpenCode cli.json. OpenCode reloads valid theme selections while the TUI is running.`, "success");
          }
          return;
        }
        case "model": {
          await context.data.location.model.sync(location);
          const models = context.data.location.model.list(location) ?? [];
          const query = arg.toLowerCase();
          const options = models.filter((model) => !query || `${model.providerID}/${model.modelID} ${model.name}`.toLowerCase().includes(query))
            .map((model) => ({ title: `${model.providerID}/${model.modelID}`, value: model, description: model.name }));
          const selected = await context.ui.dialog.select({ title: "Select provider model", placeholder: "Search provider/model…", options });
          if (selected && sessionID) {
            await context.client.session.switchModel({ sessionID, model: { providerID: selected.providerID, id: selected.id } });
            toast(`Selected ${selected.providerID}/${selected.modelID}.`, "success");
          } else if (selected) toast("Open or create a session before selecting its model.", "warning");
          return;
        }
        case "thinking": {
          if (!selectedModel) { toast("Choose a model first.", "warning"); return; }
          const variants = context.ui.model.variant.list();
          const selected = await context.ui.dialog.select({ title: "Model variant", current: selectedModel.variant, options: [{ title: "Default", value: "" }, ...variants.map((variant) => ({ title: variant, value: variant }))] });
          if (selected !== undefined) context.ui.model.variant.set(selected || undefined);
          return;
        }
        case "compact":
          if (!sessionID) { toast("/compact requires an open session.", "warning"); return; }
          {
            const result = await sessionApi.compact({ sessionID, ...(arg ? { notes: arg } : {}) });
            toast(result.admitted ? "Compaction with notes admitted to the selected session." : "Compaction was not admitted.", result.admitted ? "success" : "warning");
          }
          return;
        case "autocompact":
          if (!sessionID) { toast("/autocompact requires an open session.", "warning"); return; }
          toast("/autocompact is unavailable: OpenCode 2.0.32 exposes no per-session automatic-compaction policy in its native TUI plugin or session API. No UI-only setting was changed.", "warning");
          return;
        case "review": {
          if (!sessionID) { toast("/review requires an open session.", "warning"); return; }
          if (arg && !["ask", "yes", "no", "status"].includes(arg.toLowerCase())) { toast("Usage: /review [ask|yes|no|status]. ask/yes/no sets the Carthagent automatic-review default; bare /review always starts an independent reviewer.", "warning"); return; }
          if (arg && ["ask", "yes", "no"].includes(arg.toLowerCase())) {
            const mode = arg.toLowerCase() as "ask" | "yes" | "no";
            const config = saveCarthagentConfig({ review: mode });
            toast(`Automatic fresh-review default saved to ${carthagentConfigPath()}: ${resolveReviewMode(undefined, config)}. Bare /review remains available regardless of this default.`, "success");
            return;
          }
          if (arg.toLowerCase() === "status") { toast(`Automatic fresh-review default: ${resolveReviewMode(undefined, loadCarthagentConfig())} (Carthagent profile: ${carthagentConfigPath()}). Bare /review always starts an independent reviewer.`, "info"); return; }
          {
            const api = workspaceClient(context, location);
            const result = await api.startReview({ sessionID }, AbortSignal.timeout(5 * 60_000));
            if (result.sessionID) context.ui.router.navigate({ type: "session", sessionID: result.sessionID });
            await context.ui.dialog.alert({ title: "Independent review", message: `${result.status}\n\n${result.summary}` });
          }
          return;
        }
        case "export":
          if (!sessionID) { toast("/export requires an open session.", "warning"); return; }
          {
            const transfer = await context.client.session.export({ sessionID }, { signal: AbortSignal.timeout(60_000) });
            const messages = transfer.messages;
            const session = context.data.session.get(sessionID);
            const title = session?.title ?? "Carthagent session";
            const content = messages.map((message) => {
              const who = message.type === "assistant" ? "Assistant" : message.type === "user" ? "You" : message.type;
              const body = message.type === "assistant" ? message.content.map((part) => {
                if (part.type === "text" || part.type === "reasoning") return part.text;
                if (part.type === "tool") {
                  const state = part.state;
                  const input = typeof state.input === "string" ? state.input : JSON.stringify(state.input, null, 2);
                  const result = "content" in state && state.content ? `\nOutput: ${state.content.map((item) => item.type === "text" ? item.text : JSON.stringify(item)).join("\n")}` : "";
                  const failure = state.status === "error" ? `\nError: ${state.error.message}` : "";
                  return `[Tool ${part.name} · ${state.status}]\nInput: ${input}${result}${failure}`;
                }
                return "[Unsupported assistant content]";
              }).join("\n")
                : message.type === "user" || message.type === "synthetic" || message.type === "system" || message.type === "skill" ? message.text
                  : message.type === "shell" ? `$ ${message.command}\n${message.output?.output ?? ""}` : message.type === "compaction" ? `[Compaction ${message.status}${message.status === "completed" || message.status === "running" ? `: ${message.summary}` : `: ${message.error.message}`}]` : "";
              return body ? `<article><h2>${escapeHtml(who)}</h2><pre>${escapeHtml(body)}</pre></article>` : "";
            }).join("\n");
            const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{margin:3rem auto;max-width:52rem;padding:0 1rem;background:#160e20;color:#f6f0e7;font:16px/1.6 system-ui}h1{color:#e6c480}article{border-top:1px solid #49364f;padding:1rem 0}h2{color:#c0b3ca;font-size:.9rem}pre{white-space:pre-wrap;font:inherit}</style><h1>${escapeHtml(title)}</h1>${content}</html>`;
            const base = location.directory;
            const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "session";
            const outputPath = resolve(base, arg || `${safeTitle}.html`);
            await writeFile(outputPath, html, { encoding: "utf8", flag: "wx" });
            toast(`Session exported to ${context.ui.format.path(outputPath)}`, "success");
          }
          return;
        case "copy": {
          if (!sessionID) { toast("/copy requires an open session.", "warning"); return; }
          const { messages } = await context.client.session.export({ sessionID }, { signal: AbortSignal.timeout(60_000) });
          const latest = messages.filter((message) => message.type === "assistant")
            .sort((left, right) => (right.time.completed ?? right.time.created) - (left.time.completed ?? left.time.created))[0];
          const text = latest?.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
          if (!text) { toast("No assistant response to copy yet.", "warning"); return; }
          await copyWithHost(text);
          toast("Full assistant response copied.", "success");
          return;
        }
        case "stats": {
          if (!sessionID) { toast("/stats requires an open session.", "warning"); return; }
          const session = context.data.session.get(sessionID);
          const cachedCost = context.data.session.cost(sessionID);
          await context.data.session.message.sync(sessionID);
          const messages = context.data.session.message.list(sessionID);
          const assistants = messages.filter((message) => message.type === "assistant");
          const totals = assistants.reduce((sum, message) => {
            const tokens = message.tokens;
            if (tokens) {
              sum.input += tokens.input;
              sum.output += tokens.output;
              sum.reasoning += tokens.reasoning;
              sum.cacheRead += tokens.cache.read;
              sum.cacheWrite += tokens.cache.write;
            }
            if (message.cost !== undefined) sum.cost += message.cost;
            return sum;
          }, { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
          const hasMessageCost = assistants.some((message) => message.cost !== undefined);
          if (!hasMessageCost && Number.isFinite(cachedCost) && cachedCost > 0) totals.cost = cachedCost;
          const hasCost = hasMessageCost || Number.isFinite(cachedCost) && cachedCost > 0;
          const hasTokens = assistants.some((message) => message.tokens !== undefined);
          await context.ui.dialog.alert({ title: "Session stats", message: `${session?.title ?? sessionID}\nMessages: ${messages.length} (${assistants.length} assistant)\nInput tokens: ${hasTokens ? totals.input : "not reported"}\nOutput tokens: ${hasTokens ? totals.output : "not reported"}\nReasoning tokens: ${hasTokens ? totals.reasoning : "not reported"}\nCache read/write: ${hasTokens ? `${totals.cacheRead} / ${totals.cacheWrite}` : "not reported"}\nCost: ${hasCost ? `$${totals.cost.toFixed(4)}` : "not reported"}` });
          return;
        }
        case "account": {
          const result = await shipClient(context, location).account() as { account: Record<string, unknown> };
          await context.ui.dialog.alert({ title: "Carthagent Ship account", message: cloudAccountText(result.account) });
          return;
        }
        case "usage": {
          const [accountResult, usageResult] = await Promise.all([
            shipClient(context, location).account() as Promise<{ account: Record<string, unknown> }>,
            shipClient(context, location).usage({ limit: 50 }) as Promise<{ usage: Record<string, unknown> }>,
          ]);
          await context.ui.dialog.alert({ title: "Carthagent Ship usage", message: cloudUsageText(usageResult.usage, accountResult.account) });
          return;
        }
        case "billing": {
          const action = arg.toLowerCase() || "checkout";
          if (!["checkout", "portal"].includes(action)) { toast("Usage: /billing [checkout|portal].", "warning"); return; }
          const { url } = await shipClient(context, location).billing({ action: action as "checkout" | "portal" }) as { url: string };
          const { openBrowser } = await import("../../../lib/cloud/client.mjs");
          const opened = await openBrowser(url).catch(() => false);
          await context.ui.dialog.alert({ title: action === "portal" ? "Ship billing portal" : "Ship checkout", message: `${opened ? "Opened in your browser." : "Open this URL in your browser:"}\n${url}` });
          return;
        }
        case "logout-cloud": {
          const session = arg || undefined;
          const confirmed = await context.ui.dialog.confirm({ title: session ? "Revoke Ship session" : "Sign out of Carthagent Ship", message: session ? `Revoke Ship session ${session}?` : "Revoke the active Ship session and remove its OpenCode connection?" });
          if (confirmed !== true) return;
          await shipClient(context, location).logout(session ? { session } : {});
          toast(session ? `Revoked Ship session ${session}.` : "Revoked and removed the active Carthagent Ship connection.", "success");
          return;
        }
        case "archive": {
          const [operation, ...rest] = arg.split(/\s+/).filter(Boolean);
          const archive = archiveClient(context, location);
          if (operation && !["list", "search", "read", "export"].includes(operation)) { toast("Usage: /archive [list|search <query>|read <id>|export <id>].", "warning"); return; }
          if (operation === "search" && !rest.length) { toast("Usage: /archive search <query>.", "warning"); return; }
          if (operation === "read" || operation === "export") {
            const id = rest[0];
            if (!id) { toast(`Usage: /archive ${operation} <id>.`, "warning"); return; }
            if (operation === "read") {
              const result = await archive.read({ id }) as { records: unknown[] };
              const content = result.records.map((record: unknown) => JSON.stringify(record)).join("\n") || "Archive is empty.";
              const pageSize = 24000;
              for (let offset = 0; offset < content.length; offset += pageSize) {
                const end = Math.min(offset + pageSize, content.length);
                await context.ui.dialog.alert({ title: `Archived session ${id} · characters ${offset + 1}–${end} of ${content.length}`, message: content.slice(offset, end) });
                if (end < content.length && await context.ui.dialog.confirm({ title: "Continue archived session?", message: `Show characters ${end + 1}–${Math.min(end + pageSize, content.length)} of ${content.length}?`, label: { confirm: "Continue", cancel: "Stop reading" } }) !== true) break;
              }
            } else {
              const result = await archive.export({ id, format: "jsonl" }) as { content: string };
              const path = resolve(location.directory, `${id.replace(/[^a-zA-Z0-9._-]/g, "_")}.jsonl`);
              await writeFile(path, result.content, { encoding: "utf8", flag: "wx" });
              toast(`Complete archive export (${Buffer.byteLength(result.content, "utf8")} bytes) saved to ${context.ui.format.path(path)}.`, "success");
            }
            return;
          }
          const query = operation === "search" ? rest.join(" ") : undefined;
          let offset = 0;
          const pageSize = 50;
          while (true) {
            const result = (query
              ? await archive.search({ query, offset, limit: pageSize })
              : await archive.list({ offset, limit: pageSize })) as { total: number; offset: number; limit: number; items: Array<Record<string, unknown>> };
            const returned = result.items.length;
            const first = returned ? result.offset + 1 : 0;
            const last = result.offset + returned;
            await context.ui.dialog.alert({
              title: `${query ? "Archive search" : "Archived sessions"} · ${first}–${last} of ${result.total}`,
              message: `${returned} item(s) returned on this page${result.total > returned ? `; ${result.total} total matches` : ""}.\n\n${result.items.map(archiveItemText).join("\n\n") || (query ? "No archived sessions matched." : "No archived sessions found.")}`,
            });
            if (!returned || last >= result.total) break;
            const next = await context.ui.dialog.confirm({ title: "More archived sessions?", message: `Showing ${last} of ${result.total}. Load the next page?`, label: { confirm: "Next page", cancel: "Done" } });
            if (next !== true) break;
            offset += returned;
          }
          return;
        }
        case "clear":
          await context.ui.dialog.alert({ title: "Transcript clearing is not exposed to plugins", message: "OpenCode 2.0.32's session.revert.clear endpoint only clears a staged revert marker; it does not clear transcript messages. The native TUI plugin API has prompt.clear for the editor, but no transcript-view reset operation. This plugin will not delete durable session history or mislabel revert clearing as transcript clearing." });
          return;
        case "abort":
          if (!sessionID) { toast("/abort requires an open session.", "warning"); return; }
          await context.client.session.interrupt({ sessionID, resume: false });
          return;
        case "raw":
          if (!sessionID || !arg) { toast("Usage: /raw <prompt> (inside a session).", "warning"); return; }
          await context.client.session.prompt({ sessionID, text: arg, metadata: { "ctg.raw": true } });
          return;
        case "guide":
          if (!sessionID) { toast("/guide requires an open session.", "warning"); return; }
          if (!arg) {
            const result = await sessionApi.framing({ sessionID });
            toast(`Carthagent framing ${result.enabled ? "enabled" : "disabled"} for this session.`, "success");
            return;
          }
          await context.client.session.prompt({ sessionID, text: framePrompt(arg) });
          return;
        case "workflow": case "architecture": case "evidence":
          context.ui.router.navigate({ type: "plugin", name: "carthagent", data: { view: id, ...(sessionID ? { sessionID } : {}) } });
          return;
        case "ctg-workspace":
          context.ui.router.navigate({ type: "plugin", name: "carthagent", data: { view: "workspace" } });
          return;
        case "ctg-open": {
          const api = workspaceClient(context, location);
          if (!api) { toast("CTG workspace service is unavailable.", "warning"); return; }
          try {
            const snapshot = await api.snapshot();
            const sessions = snapshot.sessions.filter((session) => !arg || `${session.title} ${session.id}`.toLowerCase().includes(arg.toLowerCase()));
            const selected = await context.ui.dialog.select({ title: "Open CTG session", options: sessions.map((session) => ({ title: session.title, value: session.id, description: `${session.status} · ${session.id}` })) });
            if (selected) {
              await api.open({ sessionID: selected });
              context.ui.router.navigate({ type: "session", sessionID: selected });
            }
          } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); }
          return;
        }
        case "ctg-worktree":
          await createWorktree(arg);
          return;
        case "ctg-preview": case "ctg-review": {
          if (!sessionID) { toast(`/${id} requires an open session.`, "warning"); return; }
          const api = workspaceClient(context, location);
          if (!api) { toast("CTG workspace service is unavailable.", "warning"); return; }
          try {
            const result = id === "ctg-review" ? await api.review({ sessionID }) : await api.delivery({ sessionID });
            toast(result ? JSON.stringify(result) : "No CTG status is recorded for this session.", "info");
          } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); }
          return;
        }
      }
    }

    async function createWorktree(input: string) {
      const route = context.ui.router.current();
      const sessionID = route.type === "session" ? route.sessionID : route.type === "plugin" && route.name === "carthagent" && typeof route.data?.sessionID === "string" ? route.data.sessionID : undefined;
      const selectedLocation = sessionID ? context.data.session.get(sessionID)?.location : undefined;
      const api = workspaceClient(context, selectedLocation);
      if (!api) { context.ui.toast.show({ message: "CTG workspace RPC is unavailable; no worktree was created.", variant: "warning" }); return; }
      const [projectID, ...nameParts] = input.trim().split(/\s+/);
      const name = nameParts.join(" ");
      if (!projectID || !name) { context.ui.toast.show({ message: "Usage: /ctg-worktree <local-project-id> <name>.", variant: "warning" }); return; }
      try {
        const result = await api.createWorktree({ projectID, name });
        context.ui.toast.show({ message: `CTG worktree created at ${context.ui.format.path(result.directory)}`, variant: "success" });
      } catch (error) { context.ui.toast.show({ message: error instanceof Error ? error.message : String(error), variant: "error" }); }
    }

    async function copyWithHost(text: string) {
      if (!context.renderer.isOsc52Supported()) throw new Error("This terminal does not support OSC 52 clipboard copy; select and copy the response manually.");
      if (!context.renderer.copyToClipboardOSC52(text)) throw new Error("Terminal rejected clipboard copy; select and copy the response manually.");
    }

    function escapeHtml(value: string) {
      return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
    }

    cleanups.push(context.ui.slot({ append: "session.panel", render: (panel) => <Show when={panel.name === "carthagent.delivery"}><text fg={context.theme.text.base}>Carthagent delivery · session {panel.sessionID} · use /workflow or /evidence for the CTG workspace report</text></Show> }));
    cleanups.push(context.ui.slot({ append: "home.footer.status", render: () => <text fg={context.theme.hue.accent[400]}>◆ CTG</text> }));
    const stopEvents = context.data.listen(({ details }) => {
      if (details.type.startsWith("session.")) {
        const data = (details as unknown as { data?: { sessionID?: string } }).data;
        if (data?.sessionID) context.data.session.invalidate(data.sessionID);
      }
      if (details.type.startsWith("rpc.carthagent.workspace.")) context.data.project.invalidate();
    });
    cleanups.push(stopEvents);
    return () => cleanups.reverse().forEach((cleanup) => cleanup());
  },
});
