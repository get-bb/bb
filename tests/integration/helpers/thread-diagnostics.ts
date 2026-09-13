import type { ThreadEventRow } from "@bb/domain";

export function stringifyThreadEventData(
  event: ThreadEventRow | undefined,
): string {
  return JSON.stringify(event?.data ?? null);
}

export function previewThreadText(value: string | null): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 240) {
    return normalized;
  }
  return `${normalized.slice(0, 240)}...`;
}

function describeThreadEvent(event: ThreadEventRow): string {
  if (event.type === "item/completed") {
    const item = event.data.item;
    if (item.type === "toolCall") {
      const error = item.error ? ` error=${item.error}` : "";
      return `${event.seq}:${event.type}:${item.type}:${item.tool}:${item.status}${error}`;
    }
    if (item.type === "commandExecution") {
      return `${event.seq}:${event.type}:${item.type}:${item.status}:${item.approvalStatus}`;
    }
    if (item.type === "fileChange") {
      return `${event.seq}:${event.type}:${item.type}:${item.status}:${item.approvalStatus}`;
    }
    return `${event.seq}:${event.type}:${item.type}`;
  }
  if (event.type === "item/started") {
    return `${event.seq}:${event.type}:${event.data.item.type}`;
  }
  if (event.type === "provider/error" || event.type === "system/error") {
    const detail = event.data.detail ? ` ${event.data.detail}` : "";
    return `${event.seq}:${event.type}:${event.data.message}${detail}`;
  }
  return `${event.seq}:${event.type}`;
}

export function summarizeThreadEventTail(
  events: ThreadEventRow[],
  recentCount: number,
): {
  lastError: ThreadEventRow | undefined;
  lastTurnCompleted: ThreadEventRow | undefined;
  lastTurnStarted: ThreadEventRow | undefined;
  recentEvents: string;
} {
  const reversed = [...events].reverse();
  return {
    lastError: reversed.find(
      (event) =>
        event.type === "provider/error" || event.type === "system/error",
    ),
    lastTurnCompleted: reversed.find(
      (event) => event.type === "turn/completed",
    ),
    lastTurnStarted: reversed.find((event) => event.type === "turn/started"),
    recentEvents: events
      .slice(-recentCount)
      .map(describeThreadEvent)
      .join(" | "),
  };
}

export function countTurnEvents(
  events: ThreadEventRow[],
  type: "turn/completed" | "turn/started",
): number {
  return events.filter((event) => event.type === type).length;
}
