import type { PickerOption } from "./OptionPicker";

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
