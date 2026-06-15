import type { TimelineRowBase, TimelineSourceRow } from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import type {
  BuildDelegationChildRows,
  TimelineDelegationProjectionMessage,
  TimelineWorkRowBuildOptions,
  TimelineWorkflowProjectionMessage,
} from "./timeline-work-row-builder-shared.js";

interface BuildAgentWorkRowsArgs {
  base: TimelineRowBase;
  buildDelegationChildRows: BuildDelegationChildRows;
  message: TimelineDelegationProjectionMessage | TimelineWorkflowProjectionMessage;
  options: TimelineWorkRowBuildOptions;
}

export function buildAgentWorkRows({
  base,
  buildDelegationChildRows,
  message,
  options,
}: BuildAgentWorkRowsArgs): TimelineSourceRow[] {
  switch (message.kind) {
    case "delegation": {
      const buildChildRows =
        options.delegationChildRows === "all" || message.status === "pending";
      return [
        {
          ...base,
          kind: "work",
          workKind: "delegation",
          status: message.status,
          callId: message.callId,
          toolName: message.toolName,
          subagentType: message.subagentType ?? null,
          description: message.description ?? null,
          output: message.output,
          outputDetail: message.outputDetail,
          completedAt: message.completedAt,
          ...(buildChildRows
            ? {}
            : message.childProjection.entries.length > 0
              ? { childRowsOmitted: true }
              : {}),
          childRows: buildChildRows
            ? buildDelegationChildRows({
                projection: message.childProjection,
                rowIdPrefix: `${base.id}:child:`,
                workspaceRoot: options.workspaceRoot,
              })
            : [],
        },
      ];
    }
    case "workflow":
      // Ambient/housekeeping tasks stay out of the inline transcript.
      if (message.skipTranscript) {
        return [];
      }
      return [
        {
          ...base,
          kind: "work",
          workKind: "workflow",
          status: message.status,
          itemId: message.itemId,
          workflowName: message.workflowName,
          description: message.description,
          taskStatus: message.taskStatus,
          workflow: message.workflow,
          usage: message.usage,
          summary: message.summary,
          error: message.error,
          completedAt: message.completedAt,
        },
      ];
    default:
      return assertNever(message);
  }
}
