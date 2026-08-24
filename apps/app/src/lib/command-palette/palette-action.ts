import type { AppShortcutPresentation } from "@/lib/app-keybindings";

/**
 * One row of the quick palette. Producer-agnostic so ranking and rendering do
 * not care whether an action came from an app command or elsewhere.
 */
export interface PaletteAction {
  /** Stable across sessions; the recents key. `app:thread.new`. */
  id: string;
  /** Section label; also matched against the query. */
  group: string;
  title: string;
  /** Drawn as a pill on the row; null when the command has no binding. */
  shortcut: AppShortcutPresentation | null;
  /** Runs after the palette has closed and restored focus. */
  run: () => void;
}
