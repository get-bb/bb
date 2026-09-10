import type { ThreadTimelineProviderAuthRequired } from "@bb/domain";
import type { ThreadEventWithMeta } from "./group-event-projection-turns.js";

export function extractThreadTimelineProviderAuthRequired(
  events: readonly ThreadEventWithMeta[],
): ThreadTimelineProviderAuthRequired | null {
  let authRequired: ThreadTimelineProviderAuthRequired | null = null;

  for (const { event, meta } of events) {
    if (event.type === "client/turn/requested") {
      authRequired = null;
      continue;
    }
    if (
      event.type === "provider/error" &&
      event.errorInfo?.category === "unauthorized" &&
      event.willRetry !== true
    ) {
      authRequired = { sourceSeq: meta.seq };
    }
  }

  return authRequired;
}
