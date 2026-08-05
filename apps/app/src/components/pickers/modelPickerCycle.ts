import type { PickerOption } from "./OptionPicker";

/**
 * Which picker instance answers a model/reasoning cycle chord. Every mounted
 * composer registers its own handler — including side-chat composers that stay
 * mounted while hidden — so the decision scopes to the focused pane AND to a
 * single composer within it, the same way `resolveModelPickerToggle` does. The
 * cycle commands share that command's `when` conditions, so the caret decides
 * when it sits in a composer and the pane's primary composer answers otherwise
 * — e.g. right after keyboard pane navigation, where the caret is nowhere.
 */
export interface ModelPickerCycleScope {
  /** Whether this picker is disabled (locked/preview surfaces). */
  disabled: boolean;
  /** Whether this picker's split pane is the focused one. */
  isFocusedPane: boolean;
  /** Whether this picker lives inside a multi-pane split (not a lone surface). */
  isSplitPane: boolean;
  /** Whether this composer is the pane's primary composer. */
  isPrimaryComposer: boolean;
  /** The caret sits inside THIS picker's composer. */
  caretInThisComposer: boolean;
  /** The caret sits inside a DIFFERENT composer of the same focused pane. */
  caretInOtherComposerOfPane: boolean;
}

export function shouldModelPickerCycle(scope: ModelPickerCycleScope): boolean {
  if (scope.disabled) return false;
  if (!scope.isFocusedPane) return false;
  if (scope.caretInThisComposer) return true;
  if (scope.caretInOtherComposerOfPane) return false;
  if (!scope.isSplitPane) return false;
  return scope.isPrimaryComposer;
}

/**
 * The value after `current` in `options`, wrapping at the end. Returns null
 * when there is nothing to move to: an empty list, a single option, or a list
 * whose rotation lands back on `current`. A value that is absent from the list
 * rotates to the first option, so a model outside the provider's primary list
 * still has somewhere to go.
 */
export function nextCycleValue<T extends string>(
  options: readonly PickerOption<T>[],
  current: T,
): T | null {
  if (options.length === 0) return null;
  const index = options.findIndex((option) => option.value === current);
  const next = options[(index + 1) % options.length];
  if (next === undefined || next.value === current) return null;
  return next.value;
}
