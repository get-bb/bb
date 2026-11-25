import type { CodexHandledThreadItem } from "./schemas.js";

const REALTIME_HANDOFF_PATTERN =
  /^<realtime_delegation>\n {2}<input>([^<]*)<\/input>\n(?: {2}<transcript_delta>[^<]*<\/transcript_delta>\n)?<\/realtime_delegation>$/u;

function unescapeXmlText(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export function realtimeHandoffRequestText(
  item: CodexHandledThreadItem,
): string | null {
  if (item.type !== "userMessage" || item.content.length !== 1) {
    return null;
  }
  const [part] = item.content;
  if (part?.type !== "text") {
    return null;
  }
  const match = REALTIME_HANDOFF_PATTERN.exec(part.text.trim());
  const request = match ? unescapeXmlText(match[1] ?? "").trim() : "";
  return request.length > 0 ? request : null;
}
