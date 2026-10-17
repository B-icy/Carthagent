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
  assert.equal(resolveCommand("/review")?.id, "review");
  assert.equal(resolveCommand("/review-mode")?.id, "review");
  for (const name of ["workflow", "architecture", "evidence"]) assert.equal(resolveCommand(name)?.hidden, undefined);
  for (const name of ["model", "compact", "autocompact", "abort", "clear"]) assert.equal(resolveCommand(name)?.id, name);
  assert.deepEqual(matchCommand("/arch").map((item) => item.name), ["architecture"]);
  assert.deepEqual(matchCommand("/rev status"), []);
});

test("manifest prevents collisions with native OpenCode slash commands", () => {
  for (const name of NATIVE_COMMAND_COLLISIONS) assert.equal(COMMANDS.some((item) => item.name === name || item.aliases?.includes(name)), false, name);
  assert.equal(NATIVE_COMMAND_COLLISIONS.includes("help" as typeof NATIVE_COMMAND_COLLISIONS[number]), false);
  assert.deepEqual(COMMANDS.filter((item) => ["model", "compact", "abort", "resume"].includes(item.name)).map((item) => item.name), ["model", "compact", "abort", "resume"]);
});

test("theme provisioning installs the startup default through its launcher-facing export", async () => {
  const { provisionDefaultNativeTheme } = await import("../src/ui/theme-provision.mjs");
  const directory = await mkdtemp(join(tmpdir(), "ctg-default-theme-"));
  try {
    const result = await provisionDefaultNativeTheme(directory);
    assert.deepEqual(result.installed, ["carthage"]);
    const theme = parseThemeDocument(JSON.parse(await readFile(join(result.directory, "carthage.json"), "utf8")), "carthage");
    assert.equal(theme.dark.hue.yellow[400], "#d5af66");
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
    assert.equal(cliConfigPath({ XDG_CONFIG_HOME: "/tmp/profile" }, "/home/test"), "/tmp/profile/opencode/cli.json");
    assert.equal(cliConfigDirectory({ OPENCODE_CONFIG_DIR: "/tmp/opencode-profile" }), "/tmp/opencode-profile");
    assert.equal(cliConfigDirectory({ XDG_CONFIG_HOME: "/tmp/profile" }, "/home/test"), "/tmp/profile/opencode");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("native theme provisioning converts legacy palettes inside the selected OpenCode profile", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ctg-native-themes-"));
  const themeDirectory = join(directory, "themes");
  try {
    await mkdir(themeDirectory, { recursive: true });
    await writeFile(join(themeDirectory, "user-theme.json"), '{"custom":true}');
    const result = await provisionNativeThemes(directory, ["carthage", "tokyonight"]);
    assert.deepEqual(result.installed.sort(), ["carthage", "tokyonight"]);
    assert.deepEqual(JSON.parse(await readFile(join(themeDirectory, "user-theme.json"), "utf8")), { custom: true });
    const carthage = parseThemeDocument(JSON.parse(await readFile(join(themeDirectory, "carthage.json"), "utf8")), "carthage");
    const tokyonight = parseThemeDocument(JSON.parse(await readFile(join(themeDirectory, "tokyonight.json"), "utf8")), "tokyonight");
    assert.equal(carthage.dark.hue.yellow[400], "#d5af66");
    assert.equal(carthage.dark.hue.yellow[300], "#e6c480");
    assert.ok(tokyonight.dark.hue.blue[400]);
    const again = await provisionNativeThemes(directory, ["carthage"]);
    assert.deepEqual(again.installed, []);
    await writeFile(join(themeDirectory, "forest.json"), '{"userOwned":true}');
    await assert.rejects(provisionNativeThemes(directory, ["forest"]), /Refusing to replace/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
