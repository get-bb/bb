import type { TimelineRowBase, TimelineSourceRow } from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import type {
  TimelineImageViewProjectionMessage,
  TimelineWebFetchProjectionMessage,
  TimelineWebSearchProjectionMessage,
} from "./timeline-work-row-builder-shared.js";

interface BuildWebWorkRowsArgs {
  base: TimelineRowBase;
  message:
    | TimelineImageViewProjectionMessage
    | TimelineWebFetchProjectionMessage
    | TimelineWebSearchProjectionMessage;
}

export function buildWebWorkRows({
  base,
  message,
}: BuildWebWorkRowsArgs): TimelineSourceRow[] {
  switch (message.kind) {
    case "web-search":
      return [
        {
          ...base,
          kind: "work",
          workKind: "web-search",
          status: message.status,
          callId: message.callId,
          queries: message.queries,
          completedAt: message.completedAt,
        },
      ];
    case "web-fetch":
      return [
        {
          ...base,
          kind: "work",
          workKind: "web-fetch",
          status: message.status,
          callId: message.callId,
          url: message.url,
          prompt: message.prompt,
          pattern: message.pattern,
          completedAt: message.completedAt,
        },
      ];
    case "image-view":
      return [
        {
          ...base,
          kind: "work",
          workKind: "image-view",
          status: message.status,
          callId: message.callId,
          path: message.path,
          completedAt: message.completedAt,
        },
      ];
    default:
      return assertNever(message);
  }
}
