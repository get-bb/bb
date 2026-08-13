import { reasoningLevelValues, type ReasoningLevel } from "@bb/domain";
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

/**
 * The value before `current`, wrapping at the start. "Previous over the list"
 * is "next over the reversed list", so both directions share one policy for
 * wrapping, absent values, and lists too short to move within.
 */
export function previousCycleValue<T extends string>(
  options: readonly PickerOption<T>[],
  current: T,
): T | null {
  return nextCycleValue([...options].reverse(), current);
}

/**
 * The next supported reasoning value in canonical rank order, wrapping at
 * either end. Provider responses may list efforts in any order, so their array
 * order cannot define what forward and backward mean.
 */
export function cycleReasoningValue(
  options: readonly PickerOption<ReasoningLevel>[],
  current: ReasoningLevel,
  direction: "forward" | "backward",
): ReasoningLevel | null {
  const supported = new Set(options.map((option) => option.value));
  const orderedOptions = reasoningLevelValues.filter((level) =>
    supported.has(level),
  );
  const currentRank = reasoningLevelValues.indexOf(current);
  let candidate: ReasoningLevel | undefined;
  if (direction === "forward") {
    candidate = orderedOptions.find(
      (level) => reasoningLevelValues.indexOf(level) > currentRank,
    );
    candidate ??= orderedOptions[0];
  } else {
    for (let index = orderedOptions.length - 1; index >= 0; index -= 1) {
      const level = orderedOptions[index];
      if (
        level !== undefined &&
        reasoningLevelValues.indexOf(level) < currentRank
      ) {
        candidate = level;
        break;
      }
    }
    candidate ??= orderedOptions.at(-1);
  }
  if (candidate === undefined || candidate === current) return null;
  return candidate;
}
