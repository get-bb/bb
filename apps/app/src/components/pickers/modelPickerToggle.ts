/** Outcome of a Cmd+Shift+M dispatch for a single model picker instance. */
export type ModelPickerToggleAction = "open" | "close" | "ignore";

export interface ModelPickerToggleInput {
  /** Whether this picker is currently open. */
  open: boolean;
  /** Whether this picker is disabled (locked/preview surfaces). */
  disabled: boolean;
  /** Whether this picker's split pane is the focused one. */
  isFocusedPane: boolean;
  /** Whether this picker lives inside a multi-pane split (not a lone surface). */
  isSplitPane: boolean;
  /**
   * Whether this composer is the pane's primary composer (the main thread /
   * new-thread box) rather than a secondary one (a side-chat composer, which
   * stays mounted but hidden). Only the primary composer answers the keyboard
   * fallback when the caret is outside every composer.
   */
  isPrimaryComposer: boolean;
  /** The caret sits inside THIS picker's composer. */
  caretInThisComposer: boolean;
  /** The caret sits inside a DIFFERENT composer of the same focused pane. */
  caretInOtherComposerOfPane: boolean;
}

/**
 * Decides what a single {@link ModelReasoningPicker} should do when the
 * `modelPicker.toggle` command (Cmd+Shift+M) fires. Every mounted composer
 * registers its own handler — including side-chat composers that stay mounted
 * while hidden — so the decision must scope to the focused pane AND to a single
 * composer within it.
 *
 * Precedence:
 * 1. Disabled pickers never act.
 * 2. Only the focused pane participates (checked before close so a stale open
 *    picker in an unfocused pane can't swallow the chord).
 * 3. An open picker in the focused pane toggles closed.
 * 4. If the caret is inside a composer, only that composer's picker opens; a
 *    sibling composer of the same pane defers to it.
 * 5. Otherwise (caret outside every composer, e.g. after keyboard pane
 *    navigation) only a split pane's primary composer opens — lone surfaces keep
 *    their prior "do nothing unless the caret is in the composer" behavior.
 */
export function resolveModelPickerToggle(
  input: ModelPickerToggleInput,
): ModelPickerToggleAction {
  if (input.disabled) return "ignore";
  if (!input.isFocusedPane) return "ignore";
  if (input.open) return "close";
  if (input.caretInThisComposer) return "open";
  if (input.caretInOtherComposerOfPane) return "ignore";
  if (!input.isSplitPane) return "ignore";
  return input.isPrimaryComposer ? "open" : "ignore";
}
