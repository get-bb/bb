import {
  reasoningLevelValues,
  type ReasoningLevel,
} from "@bb/domain";
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
 * The adjacent supported reasoning value in canonical rank order. Provider
 * responses may list efforts in any order, so their array order cannot define
 * what increase and decrease mean.
 */
export function adjacentReasoningValue(
  options: readonly PickerOption<ReasoningLevel>[],
  current: ReasoningLevel,
  direction: "decrease" | "increase",
): ReasoningLevel | null {
  if (options.length < 2) return null;

  const supported = new Set(options.map((option) => option.value));
  const offset = direction === "increase" ? 1 : -1;
  for (
    let rank = reasoningLevelValues.indexOf(current) + offset;
    rank >= 0 && rank < reasoningLevelValues.length;
    rank += offset
  ) {
    const candidate = reasoningLevelValues[rank];
    if (candidate !== undefined && supported.has(candidate)) return candidate;
  }
  return null;
}
