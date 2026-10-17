export type ChromeGlyph = "separator" | "refresh" | "project" | "edge" | "port" | "tree" | "bullet";

const GLYPHS = {
  unicode: {
    separator: "·",
    refresh: "↻",
    project: "◆",
    edge: "→",
    port: "⇄",
    tree: "↳",
    bullet: "·",
  },
  ascii: {
    separator: "|",
    refresh: "R",
    project: "*",
    edge: "->",
    port: "<>",
    tree: "`-",
    bullet: "-",
  },
} as const satisfies Record<"ascii" | "unicode", Record<ChromeGlyph, string>>;

/** Fixed UI chrome only. Never apply these replacements to user or model text. */
export function uiChromeGlyph(name: ChromeGlyph, env: NodeJS.ProcessEnv = process.env) {
  return GLYPHS[env.CTG_TUI_GLYPHS === "ascii" ? "ascii" : "unicode"][name];
}
