import type {
  ThreadEvent,
  ThreadEventFileChange,
  ThreadEventItemPresentation,
} from "@bb/domain";
import {
  itemStatusToApprovalStatus,
  itemStatusToExecStatus,
} from "./exec-lifecycle.js";
import { getEventParentToolCallId } from "./event-decode.js";
import type {
  EventProjectionApprovalLifecycleStatus,
  EventProjectionFileEditChange,
  EventProjectionFileEditMessage,
} from "./event-projection-types.js";

function mapFileChanges(
  changes: ThreadEventFileChange[],
): EventProjectionFileEditChange[] {
  return changes.map((change) => ({
    path: change.path,
    kind: change.kind,
    movePath: change.movePath ?? null,
    diff: change.diff,
  }));
}

type FileEditStatus = EventProjectionFileEditMessage["status"];

interface FileEditPartialBase {
  callId: string;
  parentToolCallId?: string;
}

interface FileEditOutputPartial extends FileEditPartialBase {
  stdout: string;
  appendStdout: true;
  status: Extract<FileEditStatus, "pending">;
}

interface FileEditChangesPartial extends FileEditPartialBase {
  changes: EventProjectionFileEditChange[];
  approvalStatus: EventProjectionApprovalLifecycleStatus | null;
  status: FileEditStatus;
  presentation?: ThreadEventItemPresentation;
}

export type FileEditPartial = FileEditOutputPartial | FileEditChangesPartial;

export function parseFileEditFromItemEvent(
  decoded: ThreadEvent,
  parentToolCallIdOverride?: string,
): FileEditPartial | null {
  const parentToolCallId =
    parentToolCallIdOverride ?? getEventParentToolCallId(decoded);
  if (decoded.type === "item/fileChange/outputDelta") {
    const callId = decoded.itemId;
    if (!callId) return null;

    return {
      callId,
      stdout: decoded.delta,
      appendStdout: true,
      status: "pending",
      ...(parentToolCallId ? { parentToolCallId } : {}),
    };
  }

  if (decoded.type !== "item/started" && decoded.type !== "item/completed") {
    return null;
  }
  if (decoded.item.type !== "fileChange") return null;

  const callId = decoded.item.id;
  if (!callId) return null;

  const changes = mapFileChanges(decoded.item.changes);

  return {
    callId,
    changes,
    approvalStatus: itemStatusToApprovalStatus(decoded.item.approvalStatus),
    status: itemStatusToExecStatus(decoded.item.status),
    ...(decoded.item.presentation
      ? { presentation: decoded.item.presentation }
      : {}),
    ...(parentToolCallId ? { parentToolCallId } : {}),
  };
}
