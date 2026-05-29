import { reasoningLevelValues, type ReasoningLevel } from "./shared-types.js";

/**
 * When the model changes, we want the reasoning preference to follow as
 * closely as possible:
 *
 * 1. If the new model supports the previously selected level → keep it.
 * 2. Otherwise, pick the supported level with the smallest distance from
 *    the previous level in the canonical low→max ordering. On a tie, prefer
 *    the higher level (closer to max) — matches user intent that picking a
 *    high reasoning level reflects a preference for more effort, so a model
 *    switch should not silently downgrade past a closer-up option.
 *
 * Examples (using order low(1) < medium(2) < high(3) < xhigh(4) < max(5)):
 *   reconcile("max",    ["low","medium","high","xhigh"]) → "xhigh"
 *   reconcile("high",   ["low","medium","high","xhigh","max"]) → "high"
 *   reconcile("medium", ["low","high"]) → "high"   (tie at distance 1, upward)
 *   reconcile("low",    ["high","max"]) → "high"   (closest available)
 *
 * `supported` MUST be non-empty — every real model exposes at least one
 * reasoning effort. Callers that may receive an empty list should guard the
 * call themselves.
 */
export function reconcileReasoningLevel(
  previous: ReasoningLevel,
  supported: readonly ReasoningLevel[],
): ReasoningLevel {
  if (supported.length === 0) {
    throw new Error(
      "reconcileReasoningLevel requires at least one supported level",
    );
  }
  if (supported.includes(previous)) return previous;

  const previousRank = reasoningRank(previous);
  let bestLevel = supported[0];
  let bestDistance = Math.abs(reasoningRank(bestLevel) - previousRank);
  for (const candidate of supported.slice(1)) {
    const distance = Math.abs(reasoningRank(candidate) - previousRank);
    if (distance < bestDistance) {
      bestLevel = candidate;
      bestDistance = distance;
      continue;
    }
    // Tie → prefer the level with the higher rank.
    if (
      distance === bestDistance &&
      reasoningRank(candidate) > reasoningRank(bestLevel)
    ) {
      bestLevel = candidate;
    }
  }
  return bestLevel;
}

function reasoningRank(level: ReasoningLevel): number {
  // Canonical low→max ordering pinned by `reasoningLevelValues`.
  return reasoningLevelValues.indexOf(level);
}
