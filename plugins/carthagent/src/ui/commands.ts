/** One inventory for native OpenCode slash/palette discovery and dispatch. */
export type CommandId =
  | "help" | "resume" | "new" | "restart" | "theme" | "model" | "thinking"
  | "compact" | "autocompact" | "review" | "export" | "copy" | "stats"
  | "clear" | "abort" | "raw" | "guide" | "workflow" | "architecture" | "evidence"
  | "account" | "usage" | "billing" | "logout-cloud" | "archive" | "demo"
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
}

export const COMMANDS: readonly CarthagentCommand[] = [
  { id: "help", name: "help", aliases: ["ctg-help"], submitSlash: true, description: "List Carthagent commands and native shortcuts" },
  { id: "resume", name: "resume", aliases: ["sessions"], args: "[id|name]", description: "Search and resume native sessions; legacy archives are read-only" },
  { id: "restart", name: "restart", aliases: ["kill"], description: "Recover the selected session by interrupting its active turn" },
  { id: "theme", name: "theme", args: "[name]", description: "Pick or set a Carthagent-compatible theme" },
  { id: "model", name: "model", args: "[name]", description: "Search and select a provider model" },
  { id: "thinking", name: "thinking", description: "Choose a thinking variant when the model supports it" },
  { id: "compact", name: "compact", args: "[notes]", description: "Compact the selected session, optionally with notes" },
  { id: "autocompact", name: "autocompact", args: "[on|off]", description: "Toggle automatic compaction or explicitly enable or disable it for this session" },
  { id: "review", name: "review", aliases: ["review-mode"], args: "[ask|yes|no|status]", description: "Review the selected session or inspect its review default" },
  { id: "export", name: "export", args: "[file]", description: "Export the selected session as HTML" },
  { id: "copy", name: "copy", description: "Copy the full last assistant response" },
  { id: "stats", name: "stats", description: "Show native session token and cost stats" },
  { id: "clear", name: "clear", description: "Clear the visible transcript for this session without deleting history" },
  { id: "abort", name: "abort", description: "Interrupt the selected session" },
  { id: "raw", name: "raw", args: "<prompt>", description: "Send text without Carthagent delivery framing" },
  { id: "guide", name: "guide", args: "[task]", description: "Toggle framing or start a delivery-framed prompt" },
  { id: "workflow", name: "workflow", description: "Open the delivery workspace workflow view" },
  { id: "architecture", name: "architecture", description: "Open the delivery workspace architecture view" },
  { id: "evidence", name: "evidence", description: "Open observed delivery evidence" },
  { id: "account", name: "account", aliases: ["cloud"], description: "Show Ship account, credits, plan, and sessions" },
  { id: "usage", name: "usage", description: "Show recent Ship usage from the control plane" },
  { id: "billing", name: "billing", args: "[checkout|portal]", description: "Open Ship checkout or billing portal" },
  { id: "logout-cloud", name: "logout-cloud", args: "[session-id]", description: "Revoke a Ship session or sign out this profile" },
  { id: "archive", name: "archive", args: "[search <query>|read <id>|export <id>]", description: "Browse bounded read-only archived sessions" },
  { id: "demo", name: "demo", description: "Run a scripted, provider-free delivery walkthrough" },
  { id: "ctg-workspace", name: "ctg-workspace", args: "[refresh]", description: "Browse and open local CTG workspace projects, tasks, and sessions" },
  { id: "ctg-open", name: "ctg-open", args: "[search]", description: "Search local CTG sessions and open one in native OpenCode" },
  { id: "ctg-preview", name: "ctg-preview", description: "Preview CTG delivery evidence for the selected session" },
  { id: "ctg-review", name: "ctg-review", description: "Inspect CTG review status for the selected session" },
  { id: "ctg-worktree", name: "ctg-worktree", args: "<project-id> <name>", description: "Create a local CTG worktree" },
  { id: "ctg-task", name: "ctg-task", args: "<task>", description: "Create a CTG task with a native worktree and session" },
] as const;

export function matchCommand(query: string, commands: readonly CarthagentCommand[] = COMMANDS) {
  const token = query.replace(/^\//, "").toLowerCase();
  if (!token || token.includes(" ")) return [];
  return commands.filter((item) => item.name.startsWith(token) || item.aliases?.some((alias) => alias.startsWith(token)));
}

export function resolveCommand(token: string, commands: readonly CarthagentCommand[] = COMMANDS) {
  const normalized = token.replace(/^\//, "").toLowerCase();
  return commands.find((item) => item.name === normalized || item.aliases?.includes(normalized));
}

// Host-owned commands take priority. These slash names are verified against
// the V2.0.32 keybind command inventory and are intentionally not shadowed.
export const NATIVE_COMMAND_COLLISIONS = ["themes", "settings"] as const;
