import { ARCHIVE_UNDO_GRACE_MS } from "../../constants.js";
import type { Thread } from "@bb/domain";

type ArchiveUndoGraceThread = Pick<Thread, "archivedAt" | "status">;

export function archiveUndoGraceKeepsTerminals(
  thread: Pick<Thread, "archivedAt">,
  now: number,
): boolean {
  return (
    thread.archivedAt !== null &&
    thread.archivedAt + ARCHIVE_UNDO_GRACE_MS > now
  );
}

export function archiveUndoGraceKeepsTurnRunning(
  thread: ArchiveUndoGraceThread,
  now: number,
): boolean {
  return (
    thread.status === "active" && archiveUndoGraceKeepsTerminals(thread, now)
  );
}
