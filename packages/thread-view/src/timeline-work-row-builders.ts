import type { TimelineRowBase, TimelineSourceRow } from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import { buildAgentWorkRows } from "./timeline-work-row-builder-agent.js";
import { buildExecutionWorkRows } from "./timeline-work-row-builder-execution.js";
import { buildFileChangeWorkRows } from "./timeline-work-row-builder-file-change.js";
import { buildInteractionWorkRows } from "./timeline-work-row-builder-interaction.js";
import {
  type BuildDelegationChildRows,
  type TimelineWorkProjectionMessage,
  type TimelineWorkRowBuildOptions,
} from "./timeline-work-row-builder-shared.js";
import { buildWebWorkRows } from "./timeline-work-row-builder-web.js";

export type {
  BuildDelegationChildRowsArgs,
  TimelineDelegationChildRowsMode,
  TimelineWorkRowBuildOptions,
} from "./timeline-work-row-builder-shared.js";

export interface BuildTimelineWorkRowsFromMessageArgs {
  base: TimelineRowBase;
  buildDelegationChildRows: BuildDelegationChildRows;
  message: TimelineWorkProjectionMessage;
  options: TimelineWorkRowBuildOptions;
}

export function buildTimelineWorkRowsFromMessage({
  base,
  buildDelegationChildRows,
  message,
  options,
}: BuildTimelineWorkRowsFromMessageArgs): TimelineSourceRow[] {
  switch (message.kind) {
    case "command":
    case "tool-call":
      return buildExecutionWorkRows({ base, message });
    case "file-edit":
      return buildFileChangeWorkRows({ base, message, options });
    case "web-search":
    case "web-fetch":
    case "image-view":
      return buildWebWorkRows({ base, message });
    case "delegation":
    case "workflow":
      return buildAgentWorkRows({
        base,
        buildDelegationChildRows,
        message,
        options,
      });
    case "permission-grant-lifecycle":
    case "user-question-lifecycle":
      return buildInteractionWorkRows({ base, message });
    default:
      return assertNever(message);
  }
}
