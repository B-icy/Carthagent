import { strict as assert } from "node:assert";
import { test } from "node:test";
import { COMMANDS, matchCommand, NATIVE_COMMAND_COLLISIONS, resolveCommand } from "../src/ui/commands.js";
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
  for (const name of ["account", "usage", "billing", "logout-cloud", "archive", "demo"]) {
    assert.ok(resolveCommand(`/${name}`), `/${name} must resolve to a registered handler`);
  }
  assert.equal(resolveCommand("/cloud")?.id, "account");
});

test("manifest prevents collisions with native OpenCode slash commands", () => {
  for (const name of NATIVE_COMMAND_COLLISIONS) assert.equal(COMMANDS.some((item) => item.name === name || item.aliases?.includes(name)), false, name);
  assert.equal(NATIVE_COMMAND_COLLISIONS.includes("help" as typeof NATIVE_COMMAND_COLLISIONS[number]), false);
  assert.deepEqual(COMMANDS.filter((item) => ["model", "compact", "abort", "resume"].includes(item.name)).map((item) => item.name).sort(), ["abort", "compact", "model", "resume"]);
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
