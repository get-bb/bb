import type { TimelineRowBase, TimelineSourceRow } from "@bb/server-contract";
import {
  convertActivityIntent,
  type TimelineCommandProjectionMessage,
  type TimelineToolCallProjectionMessage,
} from "./timeline-work-row-builder-shared.js";

interface BuildExecutionWorkRowsArgs {
  base: TimelineRowBase;
  message: TimelineCommandProjectionMessage | TimelineToolCallProjectionMessage;
}

export function buildExecutionWorkRows({
  base,
  message,
}: BuildExecutionWorkRowsArgs): TimelineSourceRow[] {
  switch (message.kind) {
    case "command":
      return [
        {
          ...base,
          kind: "work",
          workKind: "command",
          status: message.status,
          callId: message.callId,
          command: message.command,
          cwd: message.cwd,
          source: message.source,
          output: message.output,
          outputDetail: message.outputDetail,
          exitCode: message.exitCode,
          completedAt: message.completedAt,
          approvalStatus: message.approvalStatus,
          activityIntents: message.parsedIntents.map(convertActivityIntent),
        },
      ];
    case "tool-call":
      return [
        {
          ...base,
          kind: "work",
          workKind: "tool",
          status: message.status,
          callId: message.callId,
          toolName: message.toolName,
          toolArgs: message.toolArgs,
          output: message.output,
          outputDetail: message.outputDetail,
          completedAt: message.completedAt,
          approvalStatus: message.approvalStatus,
          activityIntents: message.parsedIntents.map(convertActivityIntent),
        },
      ];
  }
}
