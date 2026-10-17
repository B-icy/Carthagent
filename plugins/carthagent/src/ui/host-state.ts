import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type NativeCliConfig = Record<string, unknown> & { theme?: { name?: string } | string };

/** Resolve OpenCode's native CLI profile config (not CTG's separate user profile). */
export function cliConfigPath(env = process.env, home = process.env.HOME ?? "") {
  const configRoot = env.OPENCODE_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode");
  return join(configRoot, "cli.json");
}

export async function readCliConfig(path: string): Promise<NativeCliConfig> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as NativeCliConfig : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/** Atomically preserve unrelated native CLI settings while selecting a theme. */
export async function writeNativeTheme(path: string, name: string) {
  const config = await readCliConfig(path);
  config.theme = typeof config.theme === "object" && config.theme !== null
    ? { ...config.theme, name }
    : { name };
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await import("node:fs/promises").then(({ rm }) => rm(temp, { force: true })).catch(() => undefined);
    throw error;
  }
}
