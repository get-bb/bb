import type { ThreadEvent } from "@bb/domain";

export function parseAssistantDeltaText(decoded: ThreadEvent): string | null {
  if (
    decoded.type !== "item/agentMessage/delta" &&
    decoded.type !== "item/plan/delta"
  ) {
    return null;
  }

  return decoded.delta.length > 0 ? decoded.delta : null;
}

export function parseAssistantFinalText(decoded: ThreadEvent): string | null {
  if (decoded.type !== "item/completed") return null;
  if (decoded.item.type === "plan") {
    return decoded.item.text.length > 0 ? decoded.item.text : null;
  }
  if (decoded.item.type !== "agentMessage") return null;
  return decoded.item.text.length > 0 ? decoded.item.text : null;
}

export function parseReasoningDeltaText(decoded: ThreadEvent): string | null {
  if (
    decoded.type !== "item/reasoning/summaryTextDelta" &&
    decoded.type !== "item/reasoning/textDelta"
  ) {
    return null;
  }

  return decoded.delta.length > 0 ? decoded.delta : null;
}

export function parseReasoningFinalText(decoded: ThreadEvent): string | null {
  if (decoded.type !== "item/completed") return null;
  if (decoded.item.type !== "reasoning") return null;
  const summaryText = decoded.item.summary.join("");
  const contentText = decoded.item.content.join("");
  const text = summaryText || contentText;
  return text.length > 0 ? text : null;
}

export function isTerminalBufferedTextFlushEvent(eventType: string): boolean {
  return (
    eventType === "system/thread/interrupted" || eventType === "turn/completed"
  );
}
