import {
  createBufferedTextInstanceKey,
  resolveBufferedTextIdentity,
} from "./buffered-text-identity.js";
import type { ThreadEventWithMeta } from "./group-event-projection-turns.js";

export const MIN_AGENT_MESSAGE_DELTAS_FOR_SUMMARY_COMPACTION = 1000;

export function compactThreadTimelineSummaryEvents(
  events: ThreadEventWithMeta[],
  precedingAgentMessageDeltaCount = 0,
): ThreadEventWithMeta[] {
  let agentMessageDeltaCount = precedingAgentMessageDeltaCount;
  const completedAssistantKeys = new Set<string>();
  for (const eventWithMeta of events) {
    const { event } = eventWithMeta;
    if (event.type === "item/agentMessage/delta") {
      agentMessageDeltaCount += 1;
      continue;
    }
    if (event.type === "item/completed" && event.item.type === "agentMessage") {
      const identity = resolveBufferedTextIdentity({
        decoded: event,
        kind: "assistant",
      });
      if (identity) {
        completedAssistantKeys.add(createBufferedTextInstanceKey(identity));
      }
    }
  }

  if (
    agentMessageDeltaCount < MIN_AGENT_MESSAGE_DELTAS_FOR_SUMMARY_COMPACTION ||
    completedAssistantKeys.size === 0
  ) {
    return events;
  }

  const retainedCompletedDeltaKeys = new Set<string>();
  const compactedEvents: ThreadEventWithMeta[] = [];

  for (const eventWithMeta of events) {
    const { event } = eventWithMeta;
    if (event.type !== "item/agentMessage/delta") {
      compactedEvents.push(eventWithMeta);
      continue;
    }

    const identity = resolveBufferedTextIdentity({
      decoded: event,
      kind: "assistant",
    });
    if (!identity) {
      compactedEvents.push(eventWithMeta);
      continue;
    }

    const assistantKey = createBufferedTextInstanceKey(identity);
    if (!completedAssistantKeys.has(assistantKey)) {
      compactedEvents.push(eventWithMeta);
      continue;
    }
    if (retainedCompletedDeltaKeys.has(assistantKey)) {
      continue;
    }
    retainedCompletedDeltaKeys.add(assistantKey);
    compactedEvents.push(eventWithMeta);
  }

  return compactedEvents;
}
