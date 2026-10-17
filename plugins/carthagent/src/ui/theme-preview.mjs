import { parseThemeDocument, resolveThemeDocument } from "@opencode/theme/tui";
import { flattenTheme, THEMES } from "../../../../lib/tui/theme.mjs";
import { convertLegacyTheme } from "./theme-provision.mjs";

const ADAPTIVE = new Set(["solarized", "okabe", "contrast", "system"]);

function hex(color) {
  return `#${[0, 1, 2].map((index) => color.buffer[index].toString(16).padStart(2, "0")).join("")}`;
}

/** Build a non-mutating sample from the shipped palette, independent of host theme selection. */
export function buildNativeThemePreview(name, preferredMode = "dark") {
  const source = THEMES[name];
  if (!source) throw new Error(`Theme “${name}” has no preview palette.`);
  const document = convertLegacyTheme(name, flattenTheme(source, "dark"), ADAPTIVE.has(name) ? flattenTheme(source, "light") : undefined);
  const parsed = parseThemeDocument(document, name);
  const mode = preferredMode === "light" && parsed.light ? "light" : "dark";
  const theme = resolveThemeDocument(parsed, mode);
  return Object.freeze({
    name,
    mode,
    background: hex(theme.background.base),
    text: hex(theme.text.base),
    accent: hex(theme.background.action.primary.base),
    sample: "Plan → Verify · Completed · Ready",
  });
}
