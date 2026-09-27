import type { TimelineRow } from "@bb/server-contract";

export function pendingTurnStartLabel(
  rows: readonly TimelineRow[],
): string | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.turnId !== null) return undefined;
    if (row.kind !== "conversation" || row.role !== "user") continue;
    if (
      row.turnRequest.kind === "message" &&
      row.turnRequest.status === "pending"
    ) {
      return "Waiting for provider to start…";
    }
    return undefined;
  }
  return undefined;
}
