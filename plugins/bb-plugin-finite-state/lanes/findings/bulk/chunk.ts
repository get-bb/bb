import { VEX_RESUMABLE_CHUNK_SIZE } from "../../../lib/remote/types.js";
import { canonicalJson } from "../../sync/serialize/canonical.js";
import type { VexTuple } from "../overlay/schema.js";

export const VEX_PLATFORM_BATCH_LIMIT = VEX_RESUMABLE_CHUNK_SIZE;

export interface VexBulkTarget {
  pvId: string;
  findingId: string;
  stableKey: string;
  action: "set" | "clear";
  tuple?: VexTuple;
}

export interface VexTargetBatch {
  pvId: string;
  action: "set" | "clear";
  tuple: VexTuple | null;
  targets: VexBulkTarget[];
}

function assertTarget(target: VexBulkTarget): void {
  if (target.pvId.length === 0 || target.findingId.length === 0 || target.stableKey.length === 0) {
    throw new TypeError("VEX bulk targets require pvId, findingId, and stableKey");
  }
  if (target.action === "set") {
    if (target.tuple === undefined || target.tuple.status === null) {
      throw new TypeError("VEX set targets require a non-null tuple status");
    }
    return;
  }
  if (target.tuple !== undefined) {
    throw new TypeError("VEX clear targets must not carry a tuple");
  }
}

function groupKey(target: VexBulkTarget): string {
  return canonicalJson([
    target.pvId,
    target.action,
    target.action === "set" ? target.tuple : null,
  ]);
}

/** Groups without mixing project versions, operations, or semantic tuples. */
export function chunkVexTargets(targets: readonly VexBulkTarget[]): VexTargetBatch[] {
  const groups = new Map<string, VexTargetBatch>();
  for (const target of targets) {
    assertTarget(target);
    const key = groupKey(target);
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        pvId: target.pvId,
        action: target.action,
        tuple: target.action === "set" ? target.tuple ?? null : null,
        targets: [],
      };
      groups.set(key, group);
    }
    group.targets.push(target);
  }

  const batches: VexTargetBatch[] = [];
  for (const group of groups.values()) {
    for (let index = 0; index < group.targets.length; index += VEX_PLATFORM_BATCH_LIMIT) {
      batches.push({
        ...group,
        targets: group.targets.slice(index, index + VEX_PLATFORM_BATCH_LIMIT),
      });
    }
  }
  return batches;
}
