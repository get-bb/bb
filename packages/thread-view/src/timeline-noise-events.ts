import type { ThreadEventType } from "@bb/domain";

export const THREAD_TIMELINE_EXCLUDED_EVENT_TYPES = [
  "thread/started",
  "thread/identity",
  "thread/contextWindowUsage/updated",
  "thread/tokenUsage/updated",
  "turn/plan/updated",
] as const satisfies readonly ThreadEventType[];

const timelineNoiseEventTypeSet = new Set<ThreadEventType>(
  THREAD_TIMELINE_EXCLUDED_EVENT_TYPES,
);

export function isIgnoredNoiseType(eventType: ThreadEventType): boolean {
  return timelineNoiseEventTypeSet.has(eventType);
}
