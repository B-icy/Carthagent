/** One inventory for native OpenCode slash/palette discovery and dispatch. */
export type CommandId =
  | "help" | "resume" | "new" | "restart" | "theme" | "model" | "thinking"
  | "compact" | "autocompact" | "review" | "export" | "copy" | "stats"
  | "clear" | "abort" | "raw" | "guide" | "workflow" | "architecture" | "evidence"
  | "login" | "account" | "usage" | "billing" | "logout-cloud" | "archive" | "demo" | "voyages" | "quests" | "goal"
  | "ctg-workspace" | "ctg-open" | "ctg-preview" | "ctg-review" | "ctg-worktree" | "ctg-task";

export interface CarthagentCommand {
  id: CommandId;
  name: string;
  aliases?: string[];
  args?: string;
  /** Keep slash input eligible for command dispatch when the composer is submitted. */
  submitSlash?: boolean;
  description: string;
  hidden?: boolean;
  /** Listed under "Advanced" in /help; still fully available. */
  advanced?: boolean;
  /**
   * The native host already registers an equivalent slash command. The plugin
   * keeps the command in /help and the palette but does not add a second,
   * conflicting slash completion row.
   */
  hostSlash?: boolean;
}

export const COMMANDS: readonly CarthagentCommand[] = [
  { id: "help", name: "help", aliases: ["ctg-help"], submitSlash: true, description: "Essential commands first, then everything else" },
  { id: "resume", name: "resume", args: "[id|name]", description: "Search and resume a session in this folder" },
  { id: "restart", name: "restart", advanced: true, aliases: ["kill"], description: "Interrupt a stuck turn; keeps the transcript" },
  { id: "theme", name: "theme", args: "[name]", description: "Pick or set a color theme" },
  { id: "model", name: "model", args: "[name]", description: "Choose the model for this session" },
  { id: "thinking", name: "thinking", hostSlash: true, description: "Choose a reasoning level (if supported)" },
  { id: "compact", name: "compact", args: "[notes]", description: "Summarize this session to free context" },
  { id: "autocompact", name: "autocompact", advanced: true, args: "[on|off]", description: "Auto-summarize when context fills [on|off]" },
  { id: "review", name: "review", aliases: ["review-mode"], args: "[ask|yes|no|status]", description: "Fresh-context review; ask|yes|no sets default" },
  { id: "export", name: "export", args: "[file]", description: "Save this session as an HTML file" },
  { id: "copy", name: "copy", description: "Copy the last full assistant reply" },
  { id: "stats", name: "stats", hostSlash: true, description: "This session's tokens and cost" },
  { id: "clear", name: "clear", description: "Clear the screen; history is kept" },
  { id: "abort", name: "abort", description: "Stop the running turn" },
  { id: "goal", name: "goal", args: "[<objective>|resume|clear]", submitSlash: true, description: "Keep working on an objective across turns until it is done" },
  { id: "raw", name: "raw", advanced: true, args: "<prompt>", description: "Advanced: send without delivery framing" },
  { id: "guide", name: "guide", advanced: true, args: "[task]", description: "Advanced: toggle delivery framing" },
  { id: "workflow", name: "workflow", description: "Delivery plan steps and progress" },
  { id: "architecture", name: "architecture", advanced: true, description: "Delivery architecture view" },
  { id: "evidence", name: "evidence", description: "Check results and evidence freshness" },
  { id: "login", name: "login", aliases: ["auth"], description: "Sign in to Carthagent Cloud; /connect for your own provider" },
  { id: "account", name: "account", aliases: ["cloud"], description: "Cloud credit, plan and signed-in devices" },
  { id: "voyages", name: "voyages", args: "[claim]", description: "Your character, ship and shop; claim a reward" },
  { id: "quests", name: "quests", description: "Daily goals: three quick wins, counted automatically" },
  { id: "usage", name: "usage", description: "Recent Carthagent Cloud usage and cost" },
  { id: "billing", name: "billing", args: "[checkout|portal|refresh]", description: "Cloud plans: checkout, portal or refresh" },
  { id: "logout-cloud", name: "logout-cloud", args: "[session-id]", description: "Sign out of Cloud or revoke a device" },
  { id: "archive", name: "archive", advanced: true, args: "[search <query>|read <id>|export <id>]", description: "Read-only sessions from Carthagent 1.0" },
  { id: "demo", name: "demo", description: "Offline walkthrough; no provider needed" },
  { id: "ctg-workspace", name: "ctg-workspace", advanced: true, args: "[refresh]", description: "Advanced: browse projects, tasks, sessions" },
  { id: "ctg-open", name: "ctg-open", advanced: true, args: "[search]", description: "Advanced: search and open a CTG session" },
  { id: "ctg-preview", name: "ctg-preview", advanced: true, description: "Advanced: delivery status for this session" },
  { id: "ctg-review", name: "ctg-review", advanced: true, description: "Advanced: review status for this session" },
  { id: "ctg-worktree", name: "ctg-worktree", advanced: true, args: "<project-id> <name>", description: "Advanced: create a git worktree" },
  { id: "ctg-task", name: "ctg-task", advanced: true, args: "<task>", description: "Advanced: new task in its own worktree" },
] as const;

/** Host-owned commands surfaced by /help so newcomers see one short starting list. */
export interface HostHelpEntry { id: string; name: string; description: string }
export const HOST_ESSENTIALS: readonly HostHelpEntry[] = [
  { id: "provider.connect", name: "connect", description: "Use your own provider for free: Claude, OpenAI, Gemini…" },
  { id: "session.new", name: "new", description: "Start a new session" },
  { id: "session.list", name: "sessions", description: "Switch to another session" },
  { id: "opencode.status", name: "status", description: "Connection, model and plugin status" },
  { id: "app.exit", name: "exit", description: "Quit Carthagent" },
] as const;

/** Plugin commands shown in the "Start here" group of /help, in order. */
export const PLUGIN_ESSENTIALS: readonly CommandId[] = ["login", "model", "demo", "review", "evidence", "account"];

export type HelpTarget = { type: "plugin"; command: CarthagentCommand } | { type: "host"; id: string };
export interface HelpOption { title: string; description: string; category: string; value: string }

/** /help options: a short "Start here" list first, then Carthagent commands, then advanced ones. */
export function helpOptions(commands: readonly CarthagentCommand[] = COMMANDS): HelpOption[] {
  const label = (command: CarthagentCommand) => `/${command.name}${command.args ? ` ${command.args}` : ""}`;
  const essentials = PLUGIN_ESSENTIALS.map((id) => commands.find((command) => command.id === id)).filter((command): command is CarthagentCommand => Boolean(command));
  const start: HelpOption[] = [
    ...essentials.slice(0, 1).map((command) => ({ title: label(command), description: command.description, category: "Start here", value: command.name })),
    ...HOST_ESSENTIALS.slice(0, 1).map((entry) => ({ title: `/${entry.name}`, description: entry.description, category: "Start here", value: `host:${entry.id}` })),
    ...essentials.slice(1).map((command) => ({ title: label(command), description: command.description, category: "Start here", value: command.name })),
    ...HOST_ESSENTIALS.slice(1).map((entry) => ({ title: `/${entry.name}`, description: entry.description, category: "Start here", value: `host:${entry.id}` })),
  ];
  const listed = new Set<string>(essentials.map((command) => command.id));
  const rest = commands.filter((command) => !listed.has(command.id) && !command.hidden && command.id !== "help");
  return [
    ...start,
    ...rest.filter((command) => !command.advanced).map((command) => ({ title: label(command), description: command.description, category: "More commands", value: command.name })),
    ...rest.filter((command) => command.advanced).map((command) => ({ title: label(command), description: command.description, category: "Advanced", value: command.name })),
  ];
}

/** Resolve a /help selection to a plugin command or a host command ID; anything else is inert. */
export function helpSelectionTarget(value: unknown, commands: readonly CarthagentCommand[] = COMMANDS): HelpTarget | undefined {
  if (typeof value === "string" && value.startsWith("host:")) {
    const entry = HOST_ESSENTIALS.find((item) => `host:${item.id}` === value);
    return entry ? { type: "host", id: entry.id } : undefined;
  }
  const command = helpSelectionCommand(value, commands);
  return command ? { type: "plugin", command } : undefined;
}

export function matchCommand(query: string, commands: readonly CarthagentCommand[] = COMMANDS) {
  const token = query.replace(/^\//, "").toLowerCase();
  if (!token || token.includes(" ")) return [];
  return commands.filter((item) => item.name.startsWith(token) || item.aliases?.some((alias) => alias.startsWith(token)));
}

export function resolveCommand(token: string, commands: readonly CarthagentCommand[] = COMMANDS) {
  const normalized = token.replace(/^\//, "").toLowerCase();
  return commands.find((item) => item.name === normalized || item.aliases?.includes(normalized));
}

/** Map a /help list value (a command name) to its command; anything else, including cancel, is inert. */
export function helpSelectionCommand(value: unknown, commands: readonly CarthagentCommand[] = COMMANDS) {
  if (typeof value !== "string" || !value) return undefined;
  return commands.find((item) => item.name === value || item.aliases?.includes(value));
}

const SIGN_IN_REQUIRED = "Sign in to Carthagent Cloud to use this command. Run /login (Google or email), then try again.";
const AUTH_FAILURE = /OAuth connection is required|not authenticated|unauthenticated|unauthorized/i;

/** Native promise RPC rejects with plain { _tag, type, message, data } objects, not Error instances. */
export function commandErrorMessage(error: unknown): string {
  if (typeof error === "string") return error || "Command failed without details.";
  const record = error && typeof error === "object" ? error as { _tag?: unknown; type?: unknown; message?: unknown } : undefined;
  const message = typeof record?.message === "string" ? record.message : "";
  if (record?.type === "unauthenticated" || record?._tag === "UnauthorizedError" || AUTH_FAILURE.test(message)) return SIGN_IN_REQUIRED;
  return message || "Command failed without details.";
}

// Host-owned commands take priority. These slash names are verified against
// the V2.0.32 keybind command inventory and are intentionally not shadowed.
export const NATIVE_COMMAND_COLLISIONS = ["themes", "settings"] as const;

// The session route registers its own slash entry for these with identical
// semantics (the plugin handler only forwards to it), so the plugin entry is
// withheld there to avoid a duplicate suggestion. Outside a session the plugin
// entry remains so the command still explains that it needs an open session.
export const NATIVE_SESSION_COMMANDS = ["clear"] as const;

export function pluginSlashAvailable(name: string, route: { readonly type: string }) {
  return !(route.type === "session" && NATIVE_SESSION_COMMANDS.includes(name as typeof NATIVE_SESSION_COMMANDS[number]));
}

/** Where a Voyages slash command goes. `/voyages` is the hub its name and the "Voyages" tab promise; daily goals stay on `/quests`. */
export type VoyagesCommandRoute =
  | { kind: "navigate"; name: "voyages" | "daily-quests"; data: Record<string, unknown> }
  | { kind: "error"; message: string };
export function voyagesCommandRoute(id: "voyages" | "quests", arg: string, sessionID?: string): VoyagesCommandRoute {
  const session = sessionID ? { sessionID } : {};
  if (id === "quests") return { kind: "navigate", name: "daily-quests", data: session };
  const word = arg.trim().toLowerCase();
  if (word === "claim") {
    if (!sessionID) return { kind: "error", message: "No session is open. Run /voyages claim inside the ctg session that finished the delivery." };
    return { kind: "navigate", name: "voyages", data: { sessionID, section: "profile", claim: true } };
  }
  if (word) return { kind: "error", message: "Usage: /voyages [claim]. Daily goals are on /quests." };
  return { kind: "navigate", name: "voyages", data: { ...session, section: "profile" } };
}
