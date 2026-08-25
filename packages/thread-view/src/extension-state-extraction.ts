import type { ThreadTimelineExtensionState } from "@bb/server-contract";
import type { ThreadEventWithMeta } from "./build-event-projection.js";
import { getOrderedThreadEvents } from "./group-event-projection-turns.js";

const THREAD_TIMELINE_EXTENSION_STATE_MAX = 32;

/** Latest snapshot wins independently for each plugin-declared state kind. */
export function extractThreadTimelineExtensionStates(
  events: readonly ThreadEventWithMeta[],
): ThreadTimelineExtensionState[] {
  const latestByKind = new Map<string, ThreadTimelineExtensionState>();
  for (const { event, meta } of getOrderedThreadEvents(events)) {
    if (event.type !== "thread/extensionState/updated") continue;
    latestByKind.set(event.kind, {
      kind: event.kind,
      payload: event.payload,
      sourceSeq: meta.seq,
    });
  }
  return [...latestByKind.values()]
    .sort((left, right) => left.kind.localeCompare(right.kind))
    .slice(0, THREAD_TIMELINE_EXTENSION_STATE_MAX);
}
