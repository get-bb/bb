import type { PlanItem, PlanOp } from "./index.js";

export interface BlastRadius {
  requiresHumanReview: boolean;
  changed: number;
  deletes: number;
  remoteCalls: number;
  surfaces: string[];
}

const WRITE_OPERATIONS = new Set<PlanOp>(["create", "update", "delete"]);

/** Summarizes the human-confirmation boundary without counting noops or unresolved conflicts as writes. */
export function blastRadius(items: readonly PlanItem[]): BlastRadius {
  const writes = items.filter((item) => WRITE_OPERATIONS.has(item.operation));
  const deletes = writes.filter((item) => item.operation === "delete").length;
  const surfaces = [...new Set(writes.map((item) => item.kind))].sort((left, right) => left.localeCompare(right));
  return {
    requiresHumanReview: deletes > 0 || writes.length > 20,
    changed: writes.length,
    deletes,
    remoteCalls: writes.length,
    surfaces,
  };
}
