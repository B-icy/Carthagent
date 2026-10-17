export type NativeThemeMode = "dark" | "light";

export interface NativeThemeSelection {
  name: string;
  mode: NativeThemeMode;
}

/** Structural subset of the host extension; compatible with older plugin typings. */
export interface NativeThemeControl {
  current(): NativeThemeSelection;
  set(selection: { name: string; mode?: NativeThemeMode }): boolean;
}

export type NativeThemeSetResult =
  | { status: "unsupported" }
  | { status: "rejected" }
  | { status: "mismatch"; current: NativeThemeSelection }
  | { status: "updated"; current: NativeThemeSelection };

/** Set through the host and verify the resolved selection, never a config-file write. */
export function setNativeTheme(
  control: NativeThemeControl | undefined,
  name: string,
  mode?: NativeThemeMode,
): NativeThemeSetResult {
  if (!control) return { status: "unsupported" };
  if (!control.set({ name, ...(mode ? { mode } : {}) })) return { status: "rejected" };
  const current = control.current();
  if (current.name !== name || (mode && current.mode !== mode)) {
    return { status: "mismatch", current };
  }
  // With an omitted mode the host resolves the requested theme's compatible
  // active mode (which may fall back from the previous theme's mode). Verify
  // the requested name, but treat the returned mode as authoritative.
  return { status: "updated", current };
}
