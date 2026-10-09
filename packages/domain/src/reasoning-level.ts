import {
  standardReasoningLevelRank,
  type ReasoningLevel,
} from "./shared-types.js";

const UNRANKED_PREVIOUS_LEVEL: ReasoningLevel = "medium";

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

  const effectivePrevious = previous === "ultracode" ? "xhigh" : previous;
  if (supported.includes(effectivePrevious)) return effectivePrevious;

  const previousRank =
    standardReasoningLevelRank(effectivePrevious) ??
    standardReasoningLevelRank(UNRANKED_PREVIOUS_LEVEL) ??
    0;
  let best: { level: ReasoningLevel; rank: number; distance: number } | null =
    null;
  for (const candidate of supported) {
    const rank = standardReasoningLevelRank(candidate);
    if (rank === null) {
      continue;
    }
    const distance = Math.abs(rank - previousRank);
    if (
      best === null ||
      distance < best.distance ||
      (distance === best.distance && rank > best.rank)
    ) {
      best = { level: candidate, rank, distance };
    }
  }
  return best?.level ?? supported[0];
}
