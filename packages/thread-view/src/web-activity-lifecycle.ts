import type { ThreadEvent } from "@bb/domain";
import { getEventParentToolCallId } from "./event-decode.js";

export interface WebSearchLifecycleEvent {
  kind: "begin" | "end";
  itemKind: "web-search";
  callId: string;
  queries: string[];
  parentToolCallId?: string;
}

export interface WebFetchLifecycleEvent {
  kind: "begin" | "end";
  itemKind: "web-fetch";
  callId: string;
  url: string;
  prompt: string | null;
  pattern: string | null;
  parentToolCallId?: string;
}

interface ImageViewLifecycleEvent {
  kind: "begin" | "end";
  itemKind: "image-view";
  callId: string;
  path: string;
  parentToolCallId?: string;
}

export type WebActivityLifecycleEvent =
  | WebSearchLifecycleEvent
  | WebFetchLifecycleEvent
  | ImageViewLifecycleEvent;

export function parseWebActivityLifecycleEvent(
  decoded: ThreadEvent,
  parentToolCallIdOverride?: string,
): WebActivityLifecycleEvent | null {
  const parentToolCallId =
    parentToolCallIdOverride ?? getEventParentToolCallId(decoded);
  if (
    (decoded.type === "item/started" || decoded.type === "item/completed") &&
    decoded.item.type === "webSearch"
  ) {
    const callId = decoded.item.id;
    if (!callId) return null;

    return {
      kind: decoded.type === "item/started" ? "begin" : "end",
      itemKind: "web-search",
      callId,
      queries: decoded.item.queries,
      ...(parentToolCallId ? { parentToolCallId } : {}),
    };
  }

  if (
    (decoded.type === "item/started" || decoded.type === "item/completed") &&
    decoded.item.type === "webFetch"
  ) {
    const callId = decoded.item.id;
    if (!callId) return null;

    return {
      kind: decoded.type === "item/started" ? "begin" : "end",
      itemKind: "web-fetch",
      callId,
      url: decoded.item.url,
      prompt: decoded.item.prompt,
      pattern: decoded.item.pattern,
      ...(parentToolCallId ? { parentToolCallId } : {}),
    };
  }

  if (
    (decoded.type === "item/started" || decoded.type === "item/completed") &&
    decoded.item.type === "imageView"
  ) {
    const callId = decoded.item.id;
    if (!callId) return null;

    return {
      kind: decoded.type === "item/started" ? "begin" : "end",
      itemKind: "image-view",
      callId,
      path: decoded.item.path,
      ...(parentToolCallId ? { parentToolCallId } : {}),
    };
  }

  return null;
}
