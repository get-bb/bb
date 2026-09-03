import type {
  ExtensionKind,
  JsonValue,
  ThreadEvent,
  ThreadEventItemPresentation,
  ThreadEventItemStatus,
  ThreadEventPlanStep,
  ThreadEventSearchMode,
} from "@bb/domain";
import { getEventParentToolCallId } from "./event-decode.js";

interface ItemActivityLifecycleBase {
  kind: "begin" | "end";
  callId: string;
  parentToolCallId?: string;
  presentation?: ThreadEventItemPresentation;
}

export interface WebSearchLifecycleEvent extends ItemActivityLifecycleBase {
  itemKind: "web-search";
  queries: string[];
}

export interface WebFetchLifecycleEvent extends ItemActivityLifecycleBase {
  itemKind: "web-fetch";
  url: string;
  prompt: string | null;
  pattern: string | null;
}

interface ImageViewLifecycleEvent extends ItemActivityLifecycleBase {
  itemKind: "image-view";
  path: string;
}

interface StatusedItemActivityLifecycleBase extends ItemActivityLifecycleBase {
  status: ThreadEventItemStatus;
}

interface ImageGenerationLifecycleEvent extends StatusedItemActivityLifecycleBase {
  itemKind: "image-generation";
  prompt: string | null;
  path: string | null;
  error: string | null;
  transparentBackground: boolean;
}

export interface FileReadLifecycleEvent extends StatusedItemActivityLifecycleBase {
  itemKind: "file-read";
  path: string;
  cmd: string | null;
}

export interface SearchLifecycleEvent extends StatusedItemActivityLifecycleBase {
  itemKind: "search";
  mode: ThreadEventSearchMode;
  query: string;
  path: string | null;
  cmd: string | null;
}

export interface PlanStepsLifecycleEvent extends StatusedItemActivityLifecycleBase {
  itemKind: "plan-steps";
  steps: ThreadEventPlanStep[];
  explanation: string | null;
}

export interface ExtensionLifecycleEvent extends StatusedItemActivityLifecycleBase {
  itemKind: "extension";
  extensionKind: ExtensionKind;
  payload: JsonValue;
  presentation: ThreadEventItemPresentation;
}

export type WebActivityLifecycleEvent =
  | WebSearchLifecycleEvent
  | WebFetchLifecycleEvent
  | ImageViewLifecycleEvent
  | ImageGenerationLifecycleEvent
  | FileReadLifecycleEvent
  | SearchLifecycleEvent
  | PlanStepsLifecycleEvent
  | ExtensionLifecycleEvent;

export function parseWebActivityLifecycleEvent(
  decoded: ThreadEvent,
  parentToolCallIdOverride?: string,
): WebActivityLifecycleEvent | null {
  const legacyImageGeneration = parseLegacyImageGeneration(decoded);
  if (legacyImageGeneration !== null) {
    return legacyImageGeneration;
  }
  if (decoded.type !== "item/started" && decoded.type !== "item/completed") {
    return null;
  }
  const parentToolCallId =
    parentToolCallIdOverride ?? getEventParentToolCallId(decoded);
  const item = decoded.item;
  const callId = item.id;
  if (!callId) return null;
  const kind = decoded.type === "item/started" ? "begin" : "end";
  const base = {
    kind,
    callId,
    ...(parentToolCallId ? { parentToolCallId } : {}),
  } as const;

  switch (item.type) {
    case "webSearch":
      return {
        ...base,
        itemKind: "web-search",
        queries: item.queries,
        ...(item.presentation ? { presentation: item.presentation } : {}),
      };
    case "webFetch":
      return {
        ...base,
        itemKind: "web-fetch",
        url: item.url,
        prompt: item.prompt,
        pattern: item.pattern,
        ...(item.presentation ? { presentation: item.presentation } : {}),
      };
    case "imageView":
      return {
        ...base,
        itemKind: "image-view",
        path: item.path,
        ...(item.presentation ? { presentation: item.presentation } : {}),
      };
    case "imageGeneration":
      return {
        ...base,
        itemKind: "image-generation",
        prompt: item.prompt,
        path: item.path,
        error: item.error,
        transparentBackground: item.transparentBackground,
        status: item.status,
        ...(item.presentation ? { presentation: item.presentation } : {}),
      };
    case "fileRead":
      return {
        ...base,
        itemKind: "file-read",
        path: item.path,
        cmd: item.cmd ?? null,
        status: item.status,
        ...(item.presentation ? { presentation: item.presentation } : {}),
      };
    case "search":
      return {
        ...base,
        itemKind: "search",
        mode: item.mode,
        query: item.query,
        path: item.path ?? null,
        cmd: item.cmd ?? null,
        status: item.status,
        ...(item.presentation ? { presentation: item.presentation } : {}),
      };
    case "planSteps":
      return {
        ...base,
        itemKind: "plan-steps",
        steps: item.steps,
        explanation: item.explanation ?? null,
        status: item.status,
        ...(item.presentation ? { presentation: item.presentation } : {}),
      };
    case "extension":
      return {
        ...base,
        itemKind: "extension",
        extensionKind: item.kind,
        payload: item.payload,
        status: item.status,
        presentation: item.presentation,
      };
    default:
      return null;
  }
}

function jsonObject(
  value: JsonValue | undefined,
): Record<string, JsonValue> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function legacyImageGenerationStatus(
  value: JsonValue | undefined,
): ThreadEventItemStatus | null {
  switch (value) {
    case "inProgress":
      return "pending";
    case "failed":
      return "failed";
    case "declined":
      return "interrupted";
    case "completed":
      return "completed";
    default:
      return null;
  }
}

function parseLegacyImageGeneration(
  decoded: ThreadEvent,
): ImageGenerationLifecycleEvent | null {
  if (
    decoded.type !== "provider/unhandled" ||
    decoded.rawType !== "item/completed" ||
    decoded.rawEvent.method !== "item/completed"
  ) {
    return null;
  }
  const params = jsonObject(decoded.rawEvent.params);
  const item = jsonObject(params?.item);
  const status = legacyImageGenerationStatus(item?.status);
  if (
    item?.type !== "imageGeneration" ||
    typeof item.id !== "string" ||
    status === null ||
    !(item.revisedPrompt === null || typeof item.revisedPrompt === "string") ||
    !(item.savedPath === undefined || typeof item.savedPath === "string") ||
    !(
      item.transparentBackground === undefined ||
      typeof item.transparentBackground === "boolean"
    ) ||
    !(item.failure === null || jsonObject(item.failure) !== null)
  ) {
    return null;
  }
  const prompt =
    typeof item.revisedPrompt === "string" ? item.revisedPrompt : null;
  const path = typeof item.savedPath === "string" ? item.savedPath : null;
  return {
    kind: "end",
    callId: item.id,
    itemKind: "image-generation",
    prompt,
    path,
    error:
      item.failure === null || item.failure === undefined
        ? null
        : "Image generation failed",
    transparentBackground:
      typeof item.transparentBackground === "boolean"
        ? item.transparentBackground
        : false,
    status,
    ...(decoded.parentToolCallId
      ? { parentToolCallId: decoded.parentToolCallId }
      : {}),
  };
}
