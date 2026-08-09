/** Outcome of a Cmd+Shift+M dispatch for a single model picker instance. */
export type ModelPickerToggleAction = "open" | "close" | "ignore";

/**
 * Which mounted picker a model-picker chord addresses. Every composer registers
 * its own handler — including side-chat composers that stay mounted while
 * hidden — so every such chord must scope to the focused pane AND to a single
 * composer within it. Shared by the toggle and the cycle chords so their scope
 * rules cannot drift apart.
 */
export interface ModelPickerScope {
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

export interface ModelPickerToggleInput extends ModelPickerScope {
  /** Whether this picker is currently open. */
  open: boolean;
}

/**
 * Whether this picker instance is the one a model-picker chord addresses.
 *
 * 1. Disabled pickers never act.
 * 2. Only the focused pane participates (checked before the open rule so a
 *    stale open picker in an unfocused pane cannot swallow the chord).
 * 3. An open picker in the focused pane owns every model-picker chord. Its
 *    popover is portaled out of the composer, so once it opens the caret rules
 *    below can no longer see it.
 * 4. If the caret is inside a composer, only that composer's picker acts; a
 *    sibling composer of the same pane defers to it.
 * 5. Otherwise (caret outside every composer, e.g. after keyboard pane
 *    navigation) only a split pane's primary composer acts — lone surfaces keep
 *    their prior "do nothing unless the caret is in the composer" behavior.
 */
export function ownsModelPickerChord(input: ModelPickerToggleInput): boolean {
  if (input.disabled) return false;
  if (!input.isFocusedPane) return false;
  if (input.open) return true;
  if (input.caretInThisComposer) return true;
  if (input.caretInOtherComposerOfPane) return false;
  if (!input.isSplitPane) return false;
  return input.isPrimaryComposer;
}

/**
 * Navigation-style model picker commands only act on the closed picker whose
 * composer contains the keyboard event target. Unlike the toggle and cycle
 * commands, they deliberately have no focused-pane fallback or open-picker
 * behavior.
 */
export function ownsClosedModelPickerNavigationChord(
  input: ModelPickerToggleInput,
): boolean {
  return (
    !input.open && input.caretInThisComposer && ownsModelPickerChord(input)
  );
}

/**
 * Decides what a single {@link ModelReasoningPicker} should do when the
 * `modelPicker.toggle` command (Cmd+Shift+M) fires. The cycle commands share
 * {@link ownsModelPickerChord} with it, so their scope rules cannot drift.
 */
export function resolveModelPickerToggle(
  input: ModelPickerToggleInput,
): ModelPickerToggleAction {
  if (!ownsModelPickerChord(input)) return "ignore";
  return input.open ? "close" : "open";
}
