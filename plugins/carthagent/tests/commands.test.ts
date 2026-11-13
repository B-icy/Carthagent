import { strict as assert } from "node:assert";
import { test } from "node:test";
import { COMMANDS, commandErrorMessage, HOST_ESSENTIALS, helpOptions, helpSelectionCommand, helpSelectionTarget, matchCommand, NATIVE_COMMAND_COLLISIONS, NATIVE_SESSION_COMMANDS, pluginSlashAvailable, resolveCommand } from "../src/ui/commands.js";
import { readFile } from "node:fs/promises";
import { parseThemeDocument } from "@opencode/theme/tui";
import { cliConfigDirectory, cliConfigPath, readCliConfig, writeNativeTheme } from "../src/ui/host-state.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provisionNativeThemes } from "../src/ui/theme-provision.mjs";

test("Carthagent command manifest resolves visible CTG commands", () => {
  assert.equal(resolveCommand("/help")?.id, "help");
  assert.equal(resolveCommand("/ctg-help")?.id, "help");
  assert.deepEqual(COMMANDS.find((item) => item.id === "help")?.aliases, ["ctg-help"]);
  assert.equal(COMMANDS.find((item) => item.id === "help")?.submitSlash, true);
  assert.equal(resolveCommand("/review")?.id, "review");
  assert.equal(resolveCommand("/review-mode")?.id, "review");
  for (const name of ["workflow", "architecture", "evidence"]) assert.equal(resolveCommand(name)?.hidden, undefined);
  for (const name of ["model", "compact", "autocompact", "abort", "clear"]) assert.equal(resolveCommand(name)?.id, name);
  assert.deepEqual(matchCommand("/arch").map((item) => item.name), ["architecture", "archive"]);
  assert.deepEqual(matchCommand("/rev status"), []);
  for (const name of ["login", "account", "usage", "billing", "logout-cloud", "archive", "demo", "voyages", "quests"]) {
    assert.ok(resolveCommand(`/${name}`), `/${name} must resolve to a registered handler`);
  }
  assert.equal(resolveCommand("/cloud")?.id, "account");
  assert.equal(resolveCommand("/auth")?.id, "login");
  assert.match(resolveCommand("/voyages")!.description, /daily goals/);
  assert.match(resolveCommand("/quests")!.description, /counted automatically/);
  assert.doesNotMatch(resolveCommand("/quests")!.description, /consent|evidence/);
});

test("command error reports read native RPC rejection objects instead of '[object Object]'", () => {
  const signIn = /^Sign in to Carthagent Cloud .*\/login/;
  // Native promise RPC rejects with plain { _tag, type, message, data } objects.
  assert.match(commandErrorMessage({ _tag: "RpcError", type: "unauthenticated", message: "An active Carthagent Cloud OAuth connection is required.", data: {} }), signIn);
  assert.match(commandErrorMessage({ _tag: "RpcInternalError", type: "rpc.internal", message: "An active Carthagent Cloud OAuth connection is required." }), signIn);
  assert.match(commandErrorMessage(new Error("An active Carthagent Cloud OAuth connection is required.")), signIn);
  assert.match(commandErrorMessage({ _tag: "UnauthorizedError", message: "Unauthorized" }), signIn);
  // Non-auth and network failures keep their useful message.
  assert.equal(commandErrorMessage({ _tag: "RpcError", type: "rpc.failed", message: "Cloud usage limit must be between 1 and 200." }), "Cloud usage limit must be between 1 and 200.");
  assert.equal(commandErrorMessage(new Error("fetch failed: ECONNREFUSED")), "fetch failed: ECONNREFUSED");
  assert.equal(commandErrorMessage("plain text"), "plain text");
  for (const opaque of [{}, { message: "" }, { message: 42 }, null, undefined, 7]) {
    const message = commandErrorMessage(opaque);
    assert.doesNotMatch(message, /\[object Object\]/);
    assert.ok(message.length > 0);
  }
});

test("/help list selections dispatch the selected command once; cancel is inert", () => {
  for (const command of COMMANDS) assert.equal(helpSelectionCommand(command.name)?.id, command.id, command.name);
  assert.equal(helpSelectionCommand("ctg-help")?.id, "help");
  assert.equal(helpSelectionCommand("cloud")?.id, "account");
  for (const cancelled of [undefined, null, "", "themes", "settings", "theme dark", "/theme"]) assert.equal(helpSelectionCommand(cancelled), undefined, String(cancelled));
});

test("/help leads with a short Start here list that includes host /connect", () => {
  const options = helpOptions();
  const start = options.filter((option) => option.category === "Start here").map((option) => option.title);
  assert.deepEqual(start, ["/login", "/connect", "/model [name]", "/demo", "/review [ask|yes|no|status]", "/evidence", "/account", "/new", "/sessions", "/status", "/exit"]);
  assert.ok(start.length <= 12, "Start here stays short");
  // Every plugin command (except /help itself) remains discoverable exactly once.
  const pluginTitles = options.filter((option) => !option.value.startsWith("host:")).map((option) => option.value);
  assert.deepEqual([...pluginTitles].sort(), COMMANDS.filter((command) => command.id !== "help").map((command) => command.name).sort());
  // Advanced and internal commands are grouped last.
  const categories = options.map((option) => option.category);
  assert.equal(categories.lastIndexOf("Start here") < categories.indexOf("More commands"), true);
  assert.equal(categories.lastIndexOf("More commands") < categories.indexOf("Advanced"), true);
  for (const name of ["raw", "guide", "ctg-workspace", "ctg-task", "ctg-worktree", "archive"]) {
    assert.equal(options.find((option) => option.value === name)?.category, "Advanced", name);
  }
  // /connect is searchable in /help and dispatches the host integration picker.
  const connect = options.find((option) => option.title === "/connect");
  assert.ok(connect && /own provider/i.test(connect.description));
  assert.deepEqual(helpSelectionTarget(connect!.value), { type: "host", id: "provider.connect" });
  assert.deepEqual(helpSelectionTarget("host:not-a-command"), undefined);
  assert.equal(helpSelectionTarget("model")?.type, "plugin");
  for (const entry of HOST_ESSENTIALS) assert.equal(COMMANDS.some((command) => command.name === entry.name), false, `${entry.name} is host-owned`);
});

test("command descriptions are short, Cloud-named and fit the palette column", () => {
  for (const command of COMMANDS) {
    assert.doesNotMatch(command.description, /\bShip\b/, `${command.name} still says Ship`);
    assert.ok(command.description.length <= 60, `${command.name} description is ${command.description.length} chars`);
  }
  assert.match(resolveCommand("/login")!.description, /Cloud.*\/connect.*own provider/);
  assert.match(resolveCommand("/billing")!.args!, /refresh/);
});

test("plugin does not add duplicate slash rows for host-owned equivalents", () => {
  // /sessions and /thinking are already native host slash commands.
  assert.equal(resolveCommand("/sessions"), undefined);
  assert.equal(resolveCommand("/thinking")?.hostSlash, true);
  const slashNames = COMMANDS.filter((command) => !command.hostSlash).flatMap((command) => [command.name, ...(command.aliases ?? [])]);
  for (const host of ["sessions", "thinking", "stats", "connect", "new", "status", "exit", "models", "variants"]) assert.equal(slashNames.includes(host), false, host);
});

test("manifest prevents collisions with native OpenCode slash commands", () => {
  for (const name of NATIVE_COMMAND_COLLISIONS) assert.equal(COMMANDS.some((item) => item.name === name || item.aliases?.includes(name)), false, name);
  assert.equal(NATIVE_COMMAND_COLLISIONS.includes("help" as typeof NATIVE_COMMAND_COLLISIONS[number]), false);
  assert.deepEqual(COMMANDS.filter((item) => ["model", "compact", "abort", "resume"].includes(item.name)).map((item) => item.name).sort(), ["abort", "compact", "model", "resume"]);
});

test("/clear has one slash entry: native in sessions, plugin fallback elsewhere", () => {
  assert.deepEqual([...NATIVE_SESSION_COMMANDS], ["clear"]);
  assert.equal(pluginSlashAvailable("clear", { type: "session" }), false);
  for (const type of ["home", "plugin", "projects"]) assert.equal(pluginSlashAvailable("clear", { type }), true, type);
  // Commands whose plugin semantics differ from the native entry stay registered.
  for (const name of ["autocompact", "stats", "resume", "thinking", "help"]) assert.equal(pluginSlashAvailable(name, { type: "session" }), true, name);
  // /help list selections still reach the plugin dispatcher, which hands off to the native action.
  assert.equal(helpSelectionCommand("clear")?.id, "clear");
});

test("theme provisioning installs the startup default through its launcher-facing export", async () => {
  const { provisionDefaultNativeTheme } = await import("../src/ui/theme-provision.mjs");
  const directory = await mkdtemp(join(tmpdir(), "ctg-default-theme-"));
  try {
    const result = await provisionDefaultNativeTheme(directory);
    assert.ok(result.installed.includes("carthage"));
    const theme = parseThemeDocument(JSON.parse(await readFile(join(result.directory, "carthage.json"), "utf8")), "carthage");
    assert.equal(theme.dark.hue.yellow[400], "#d5af66");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("startup theme provisioning covers compatibility themes and preserves host/user themes", async () => {
  const { provisionDefaultNativeTheme } = await import("../src/ui/theme-provision.mjs");
  const directory = await mkdtemp(join(tmpdir(), "ctg-startup-themes-"));
  try {
    await mkdir(join(directory, "themes"), { recursive: true });
    await writeFile(join(directory, "themes", "forest.json"), '{"userOwned":true}');
    const result = await provisionDefaultNativeTheme(directory);
    assert.ok(result.installed.includes("carthage"));
    assert.ok(result.installed.includes("forest") === false);
    assert.ok(result.conflicts.includes("forest"));
    assert.ok(result.installed.includes("opencode") === false);
    assert.ok(result.installed.includes("tokyonight") === false);
    assert.deepEqual(JSON.parse(await readFile(join(directory, "themes", "forest.json"), "utf8")), { userOwned: true });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Carthage theme validates against the OpenCode V2 theme schema and resolver", async () => {
  const raw = JSON.parse(await readFile(new URL("../themes/carthage.json", import.meta.url), "utf8"));
  const resolved = parseThemeDocument(raw, "carthage");
  assert.ok(resolved.dark?.hue.yellow);
  assert.equal(resolved.base.categorical?.length, 5);
});

test("native CLI theme write preserves unrelated cli.json settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ctg-cli-config-"));
  const path = join(directory, "cli.json");
  try {
    await writeFile(path, JSON.stringify({ theme: { name: "opencode", mode: "dark" }, session: { thinking: "show" }, custom: true }));
    await writeNativeTheme(path, "carthage");
    const config = await readCliConfig(path);
    assert.deepEqual(config.theme, { name: "carthage", mode: "dark" });
    assert.deepEqual(config.session, { thinking: "show" });
    assert.equal(config.custom, true);
    assert.equal(cliConfigPath({ XDG_CONFIG_HOME: "/tmp/profile" }, "/home/test"), join("/tmp/profile", "opencode", "cli.json"));
    assert.equal(cliConfigDirectory({ OPENCODE_CONFIG_DIR: "/tmp/opencode-profile" }), "/tmp/opencode-profile");
    assert.equal(cliConfigDirectory({ XDG_CONFIG_HOME: "/tmp/profile" }, "/home/test"), join("/tmp/profile", "opencode"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("native theme provisioning converts legacy palettes inside the selected OpenCode profile", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ctg-native-themes-"));
  const themeDirectory = join(directory, "themes");
  try {
    await mkdir(themeDirectory, { recursive: true });
    await writeFile(join(themeDirectory, "user-theme.json"), '{"custom":true}');
    const result = await provisionNativeThemes(directory, ["carthage", "nebula"]);
    assert.deepEqual(result.installed.sort(), ["carthage", "nebula"]);
    assert.deepEqual(JSON.parse(await readFile(join(themeDirectory, "user-theme.json"), "utf8")), { custom: true });
    const carthage = parseThemeDocument(JSON.parse(await readFile(join(themeDirectory, "carthage.json"), "utf8")), "carthage");
    const nebula = parseThemeDocument(JSON.parse(await readFile(join(themeDirectory, "nebula.json"), "utf8")), "nebula");
    assert.equal(carthage.dark.hue.yellow[400], "#d5af66");
    assert.equal(carthage.dark.hue.yellow[300], "#e6c480");
    assert.ok(nebula.dark.hue.blue[400]);
    const again = await provisionNativeThemes(directory, ["carthage"]);
    assert.deepEqual(again.installed, []);
    await writeFile(join(themeDirectory, "forest.json"), '{"userOwned":true}');
    await assert.rejects(provisionNativeThemes(directory, ["forest"]), /Refusing to replace/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
