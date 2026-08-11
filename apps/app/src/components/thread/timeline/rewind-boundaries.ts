import type { ThreadRewindBranchHistoryResponse } from "@bb/server-contract";
import type { TimelineRow } from "@bb/server-contract";

/**
 * A rewind boundary the timeline renders as a marker. `beforeRowIndex` is the
 * index into the raw (server) timeline row array at which the marker should
 * be inserted — the first row that belongs to the rewound branch.
 */
export interface TimelineRewindBoundary {
  beforeRowIndex: number;
  cutoffSequence: number;
  branchId: string;
}

/**
 * Compute the timeline row indices where rewind markers belong. A rewind
 * branch's `cutoffSequence` is the last event sequence persisted before the
 * provider branch was created, so the first row whose `sourceSeqStart` lies
 * after the cutoff is the first row rendered from the rewound conversation.
 *
 * The marker for a rewind branch separates the timeline before the rewind
 * from the timeline after it — including when that rewind branch is the
 * currently active one (the user is looking at the rewound history).
 */
export function computeTimelineRewindBoundaries(args: {
  history: ThreadRewindBranchHistoryResponse | undefined;
  rows: readonly TimelineRow[];
}): TimelineRewindBoundary[] {
  const rewindBranches = args.history?.branches.filter(
    (branch) => branch.creationReason === "rewind",
  );
  if (!rewindBranches || rewindBranches.length === 0) {
    return [];
  }

  const boundaries: TimelineRewindBoundary[] = [];
  for (const { id: branchId, cutoffSequence } of rewindBranches) {
    const beforeRowIndex = args.rows.findIndex(
      (row) => row.sourceSeqStart > cutoffSequence,
    );
    if (beforeRowIndex === -1) {
      continue;
    }
    boundaries.push({ beforeRowIndex, branchId, cutoffSequence });
  }
  return boundaries.sort(
    (left, right) => left.beforeRowIndex - right.beforeRowIndex,
  );
}
