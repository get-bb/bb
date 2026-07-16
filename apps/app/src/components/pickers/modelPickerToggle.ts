/** Outcome of a Cmd+Shift+M dispatch for a single model picker instance. */
export type ModelPickerToggleAction = "open" | "close" | "ignore";

export interface ModelPickerToggleInput {
  /** Whether this picker is currently open. */
  open: boolean;
  /** Whether this picker is disabled (locked/preview surfaces). */
  disabled: boolean;
  /** Whether this picker's split pane is the focused one. */
  isFocusedPane: boolean;
  /**
   * The `[data-app-composer]` element the keyboard event originated in, or null
   * when focus sits outside any composer (e.g. after keyboard pane navigation).
   */
  targetComposer: Element | null;
  /** The `[data-app-composer]` element this picker belongs to, if any. */
  pickerComposer: Element | null;
}

/**
 * Decides what a single {@link ModelReasoningPicker} should do when the
 * `modelPicker.toggle` command (Cmd+Shift+M) fires. Every composer registers its
 * own handler, so the decision must both scope to the focused split pane and, for
 * panes with several composers (main + side chat), pick the composer the cursor
 * sits in.
 *
 * - An already-open picker always closes, so the chord dismisses whatever popover
 *   is showing regardless of focus.
 * - Otherwise only the focused pane may open. When the cursor is inside a specific
 *   composer, only that composer's picker opens; when focus is outside every
 *   composer (keyboard pane nav, body focus), the focused pane's picker opens.
 */
export function resolveModelPickerToggle(
  input: ModelPickerToggleInput,
): ModelPickerToggleAction {
  if (input.disabled) return "ignore";
  if (input.open) return "close";
  if (!input.isFocusedPane) return "ignore";
  if (
    input.targetComposer !== null &&
    input.targetComposer !== input.pickerComposer
  ) {
    return "ignore";
  }
  return "open";
}
