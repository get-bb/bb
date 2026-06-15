import type { ThreadEventType } from "@bb/domain";

const DEFAULT_QUIET_TIMELINE_EVENT_TYPES = [
  "client/thread/start",
  "client/turn/start",
  "item/plan/delta",
  "provider/unhandled",
  "thread/name/updated",
  "turn/diff/updated",
] as const satisfies readonly ThreadEventType[];

export const THREAD_TIMELINE_EXCLUDED_EVENT_TYPES = [
  "thread/started",
  "thread/identity",
  "thread/contextWindowUsage/updated",
  "thread/tokenUsage/updated",
  "turn/plan/updated",
] as const satisfies readonly ThreadEventType[];

const defaultQuietTimelineEventTypeSet = new Set<ThreadEventType>(
  DEFAULT_QUIET_TIMELINE_EVENT_TYPES,
);
const timelineNoiseEventTypeSet = new Set<ThreadEventType>(
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
);

export function isIgnoredNoiseType(eventType: ThreadEventType): boolean {
  return timelineNoiseEventTypeSet.has(eventType);
}

export function isDefaultQuietTimelineEventType(
  eventType: ThreadEventType,
): boolean {
  return defaultQuietTimelineEventTypeSet.has(eventType);
}
