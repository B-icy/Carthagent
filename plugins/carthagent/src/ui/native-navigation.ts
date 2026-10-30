import type { Context } from "@opencode/plugin/tui/context";
import type { JSX } from "solid-js";

/** Optional host extension: released runtimes retain slash-command navigation. */
export type NavigationInput = {
  readonly width: number;
  readonly compact: boolean;
  readonly active: boolean;
  readonly focused: boolean;
  readonly sessionID?: string;
  readonly focus: () => void;
  readonly blur: () => void;
};

export type NativeNavigation = {
  register(pane: { name: string; title: string; render(input: NavigationInput): JSX.Element }): () => void;
  select(name: string): boolean;
  current(): string;
};

export function nativeNavigation(context: Pick<Context, "ui">) {
  return (context.ui as Context["ui"] & { navigation?: NativeNavigation }).navigation;
}
