import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { flattenTheme, THEMES } from "../../../../lib/tui/theme.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const COLORS = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "gray"];
const STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

function mixHex(color, target, amount) {
  const expand = (value) => {
    const hex = value.slice(1);
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
    return full.match(/[\da-f]{2}/gi)?.map((part) => Number.parseInt(part, 16)) ?? [128, 128, 128];
  };
  const source = expand(color);
  const destination = expand(target);
  return `#${source.map((channel, index) => Math.round(channel * (1 - amount) + destination[index] * amount).toString(16).padStart(2, "0")).join("")}`;
}

function buildPalette(palette) {
  const fallback = "#808080";
  const semantic = { red: palette.error, orange: palette.warning, yellow: palette.warning, green: palette.success, cyan: palette.info, blue: palette.info, purple: palette.primary ?? palette.secondary, gray: palette.textMuted };
  const darkMode = Number.parseInt(palette.background?.slice(1, 3) ?? "80", 16) < 128;
  const hue = Object.fromEntries(COLORS.map((color) => {
    const source = typeof semantic[color] === "string" && /^#[\da-f]{6}$/i.test(semantic[color]) ? semantic[color] : fallback;
    const scale = Object.fromEntries(STEPS.map((step) => {
      const progress = (step - 100) / 800;
      const towardLight = darkMode ? progress < 0.5 : progress >= 0.5;
      const distance = Math.abs(progress - 0.5) / 0.5;
      const amount = 0.78 * distance;
      return [step, mixHex(source, towardLight ? "#ffffff" : "#000000", amount)];
    }));
    return [color, scale];
  }));
  hue.accent = "$hue.purple";
  hue.interactive = "$hue.purple";
  hue.neutral = "$hue.gray";
  const token = (value) => {
    if (typeof value !== "string" || !/^#[\da-f]{3,8}$/i.test(value)) return value;
    return value;
  };
  const state = (base) => ({ base: token(base), $hovered: token(base), $pressed: token(base), $focused: token(base), $selected: token(base), $disabled: token(base) });
  const feedback = (base) => ({ base: token(base), muted: token(base) });
  return {
    hue,
    text: {
      base: token(palette.text), muted: token(palette.textMuted), faint: token(palette.textMuted),
      action: { primary: state(palette.primary), secondary: state(palette.secondary), destructive: state(palette.error) },
      formfield: state(palette.text),
      feedback: { info: feedback(palette.info), success: feedback(palette.success), warning: feedback(palette.warning), error: feedback(palette.error) },
    },
    background: {
      base: token(palette.background),
      raised: { base: token(palette.backgroundPanel), high: token(palette.backgroundElement), max: token(palette.border) },
      action: { primary: state(palette.accent), secondary: state(palette.backgroundElement), destructive: state(palette.error) },
      formfield: state(palette.background),
      feedback: { info: { base: token(palette.info) }, success: { base: token(palette.success) }, warning: { base: token(palette.warning) }, error: { base: token(palette.error) } },
    },
    border: { base: token(palette.border) }, scrollbar: { base: token(palette.borderActive ?? palette.accent) },
    diff: {
      text: { added: token(palette.diffAdded), removed: token(palette.diffRemoved), context: token(palette.diffContext), hunkHeader: token(palette.diffHunkHeader) },
      background: { added: token(palette.diffAddedBg), removed: token(palette.diffRemovedBg), context: token(palette.diffContextBg) },
      highlight: { added: token(palette.diffHighlightAdded), removed: token(palette.diffHighlightRemoved) },
      lineNumber: { text: token(palette.diffLineNumber), background: { added: token(palette.diffAddedLineNumberBg), removed: token(palette.diffRemovedLineNumberBg) } },
    },
    syntax: { comment: token(palette.syntaxComment), keyword: token(palette.syntaxKeyword), function: token(palette.syntaxFunction), variable: token(palette.syntaxVariable), string: token(palette.syntaxString), number: token(palette.syntaxNumber), type: token(palette.syntaxType), operator: token(palette.syntaxOperator), punctuation: token(palette.syntaxPunctuation) },
    markdown: { text: token(palette.markdownText), heading: token(palette.markdownHeading), link: token(palette.markdownLink), linkText: token(palette.markdownLinkText), code: token(palette.markdownCode), blockQuote: token(palette.markdownBlockQuote), emphasis: token(palette.markdownEmph), strong: token(palette.markdownStrong), horizontalRule: token(palette.markdownHorizontalRule), listItem: token(palette.markdownListItem), listEnumeration: token(palette.markdownListEnumeration), image: token(palette.markdownImage), imageText: token(palette.markdownImageText), codeBlock: token(palette.markdownCodeBlock) },
  };
}

/** Convert a legacy flat semantic palette into OpenCode's native theme JSON. */
export function convertLegacyTheme(name, palette, lightPalette) {
  const dark = buildPalette(palette);
  const light = lightPalette ? buildPalette(lightPalette) : undefined;
  const { hue: darkHue, ...base } = dark;
  const lightHue = light?.hue ?? (name === "paper" || name.includes("light") ? darkHue : undefined);
  return {
    $schema: "https://opencode.ai/theme.json",
    base: { ...base, categorical: ["accent", "purple", "cyan", "green", "blue"] },
    dark: { hue: darkHue },
    ...(lightHue ? { light: { hue: lightHue } } : {}),
  };
}

/** Copy selected Carthagent compatibility themes into one OpenCode profile. */
export async function provisionNativeThemes(profileConfigDir, names = Object.keys(THEMES)) {
  const destination = join(profileConfigDir, "themes");
  await mkdir(destination, { recursive: true });
  const installed = [];
  for (const name of names) {
    const source = THEMES[name];
    if (!source) throw new Error(`Unknown Carthagent theme: ${name}`);
    const path = join(destination, `${name}.json`);
    let exists = false;
    try {
      const existing = JSON.parse(await readFile(path, "utf8"));
      exists = true;
      if (existing.$schema === "https://opencode.ai/theme.json" && existing.dark) continue;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (exists) throw new Error(`Refusing to replace a non-native theme at ${path}`);
    const document = name === "carthage"
      ? JSON.parse(await readFile(join(PACKAGE_ROOT, "themes", "carthage.json"), "utf8"))
      : convertLegacyTheme(name, flattenTheme(source, "dark"), ["solarized", "okabe", "contrast", "system"].includes(name) ? flattenTheme(source, "light") : undefined);
    const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await copyFile(temp, path, 1);
      await rm(temp, { force: true });
    } catch (error) {
      await import("node:fs/promises").then(({ rm }) => rm(temp, { force: true })).catch(() => undefined);
      throw error;
    }
    installed.push(name);
  }
  return { directory: destination, installed };
}

/** Launcher hook: install Carthagent's default theme before OpenCode scans themes. */
export async function provisionDefaultNativeTheme(profileConfigDir) {
  const compatibilityNames = Object.keys(THEMES).filter((name) => !["opencode", "tokyonight"].includes(name));
  const installed = [];
  const conflicts = [];
  for (const name of compatibilityNames) {
    try { installed.push(...(await provisionNativeThemes(profileConfigDir, [name])).installed); }
    catch (error) {
      if (!error.message.startsWith("Refusing to replace a non-native theme at ")) throw error;
      conflicts.push(name);
    }
  }
  return { directory: join(profileConfigDir, "themes"), installed, conflicts };
}
