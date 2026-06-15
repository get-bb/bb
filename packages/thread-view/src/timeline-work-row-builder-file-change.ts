import type { TimelineRowBase, TimelineSourceRow } from "@bb/server-contract";
import {
  toTimelineFileChange,
  type TimelineFileEditProjectionMessage,
  type TimelineWorkRowBuildOptions,
} from "./timeline-work-row-builder-shared.js";

interface BuildFileChangeWorkRowsArgs {
  base: TimelineRowBase;
  message: TimelineFileEditProjectionMessage;
  options: TimelineWorkRowBuildOptions;
}

export function buildFileChangeWorkRows({
  base,
  message,
  options,
}: BuildFileChangeWorkRowsArgs): TimelineSourceRow[] {
  if (message.changes.length === 0 && message.approvalStatus !== null) {
    return [
      {
        ...base,
        kind: "work",
        workKind: "approval",
        status: message.status,
        interactionId: message.callId,
        approvalKind: "file-edit",
        lifecycle: message.approvalStatus === "denied" ? "denied" : "waiting",
        target: {
          itemId: message.callId,
          toolName: null,
        },
      },
    ];
  }
  return message.changes.map((change, index) => ({
    ...base,
    id: `${base.id}:file-change:${index}`,
    kind: "work",
    workKind: "file-change",
    status: message.status,
    callId: message.callId,
    change: toTimelineFileChange(change, options.workspaceRoot),
    stdout: message.stdout ?? null,
    stderr: message.stderr ?? null,
    approvalStatus: message.approvalStatus,
  }));
}
