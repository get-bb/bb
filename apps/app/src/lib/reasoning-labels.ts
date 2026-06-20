import type { ReasoningLevel } from "@bb/domain";

/**
 * Short, user-facing labels for each reasoning level. Shared by the
 * thread-creation options hook (committed model) and the model/reasoning
 * picker (previewed provider) so the two never drift — adding a level forces
 * an entry here once.
 */
export const REASONING_LABELS: Record<ReasoningLevel, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  ultracode: "Ultracode",
  max: "Max",
};
