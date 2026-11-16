import type {
  TimelineRow,
  TimelineRowPatcher,
  TimelineRowPatchOperation,
} from "@bb/server-contract";

let registeredPatcher: TimelineRowPatcher | null = null;

export function registerTimelineRowPatcher(
  patcher: TimelineRowPatcher,
): () => void {
  registeredPatcher = patcher;
  return () => {
    if (registeredPatcher === patcher) {
      registeredPatcher = null;
    }
  };
}

export function patchCachedTimelineRow(
  row: TimelineRow,
  ops: readonly TimelineRowPatchOperation[],
): TimelineRow | null {
  return registeredPatcher === null ? null : registeredPatcher(row, ops);
}
