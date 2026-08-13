import type { PlanItem, PlanOp } from "./index.js";

export interface BlastRadius {
  requiresHumanReview: boolean;
  changed: number;
  deletes: number;
  remoteCalls: number;
  surfaces: string[];
}

const WRITE_OPERATIONS = new Set<PlanOp>(["create", "update", "delete"]);
const CHANGED_OPERATIONS = new Set<PlanOp>(["create", "update", "delete", "conflict"]);

/** Summarizes the human-confirmation boundary without counting noops or unresolved conflicts as writes. */
export function blastRadius(items: readonly PlanItem[]): BlastRadius {
  const writes = items.filter((item) => WRITE_OPERATIONS.has(item.operation));
  const changed = items.filter((item) => CHANGED_OPERATIONS.has(item.operation));
  const deletes = writes.filter((item) => item.operation === "delete").length;
  const surfaces = [...new Set(changed.map((item) => item.kind))].sort((left, right) => left.localeCompare(right));
  return {
    requiresHumanReview: deletes > 0 || changed.length > 20,
    changed: changed.length,
    deletes,
    remoteCalls: writes.length,
    surfaces,
  };
}
