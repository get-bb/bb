import { assertNever } from "./assert-never.js";
import type {
  BuildTimelineRowTitleOptions,
  TimelineTitle,
} from "./timeline-row-title.js";
import type { TimelineViewWorkRow } from "./timeline-view.js";
import {
  mapDelegationTitle,
  mapWorkflowTitle,
} from "./timeline-work-row-title-agent.js";
import { mapExecutionTitle } from "./timeline-work-row-title-execution.js";
import { mapFileChangeTitle } from "./timeline-work-row-title-file-change.js";
import {
  mapApprovalTitle,
  mapQuestionTitle,
} from "./timeline-work-row-title-interaction.js";
import {
  mapImageViewTitle,
  mapWebFetchTitle,
  mapWebSearchTitle,
} from "./timeline-work-row-title-web.js";

export { buildTimelineActivityIntentTitles } from "./timeline-work-row-title-execution.js";

export function mapWorkTitle(
  row: TimelineViewWorkRow,
  options: BuildTimelineRowTitleOptions,
): TimelineTitle {
  const title = (() => {
    switch (row.workKind) {
      case "command":
      case "tool":
        return mapExecutionTitle(row);
      case "file-change":
        return mapFileChangeTitle(row);
      case "web-search":
        return mapWebSearchTitle(row);
      case "web-fetch":
        return mapWebFetchTitle(row);
      case "image-view":
        return mapImageViewTitle(row);
      case "delegation":
        return mapDelegationTitle(row);
      case "workflow":
        return mapWorkflowTitle(row);
      case "approval":
        return mapApprovalTitle(row);
      case "question":
        return mapQuestionTitle(row);
      default:
        return assertNever(row);
    }
  })();
  if (options.workStyle === "default") {
    return title;
  }
  // Summary work-style mutes the title via tone; segment-level `em` is kept
  // so content emphasis stays visible inside the muted wrapper, per spec.
  return {
    ...title,
    tone: "summary",
  };
}
