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

/** The value before `current`, wrapping at the start. */
export function previousCycleValue<T extends string>(
  options: readonly PickerOption<T>[],
  current: T,
): T | null {
  if (options.length === 0) return null;
  const index = options.findIndex((option) => option.value === current);
  const previousIndex = index < 0 ? options.length - 1 : index - 1;
  const previous = options[(previousIndex + options.length) % options.length];
  if (previous === undefined || previous.value === current) return null;
  return previous.value;
}

/**
 * The adjacent reasoning value in the requested direction. Unlike cycling,
 * directional changes clamp at either end. A current value outside the list
 * enters from the edge implied by the direction.
 */
export function adjacentReasoningValue<T extends string>(
  options: readonly PickerOption<T>[],
  current: T,
  direction: "decrease" | "increase",
): T | null {
  if (options.length < 2) return null;

  const currentIndex = options.findIndex((option) => option.value === current);
  if (currentIndex < 0) {
    return direction === "increase"
      ? options[0]!.value
      : options[options.length - 1]!.value;
  }

  const offset = direction === "increase" ? 1 : -1;
  return options[currentIndex + offset]?.value ?? null;
}
