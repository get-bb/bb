import type { ThreadEventItemStatus } from "./provider-event.js";

export interface LegacyImageGenerationCompletion {
  callId: string;
  error: string | null;
  item: Record<string, unknown>;
  path: string | null;
  prompt: string | null;
  status: ThreadEventItemStatus;
  transparentBackground: boolean;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return isJsonObject(value) ? value : null;
}

function imageGenerationStatus(value: unknown): ThreadEventItemStatus | null {
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

export function parseLegacyImageGenerationCompletion(
  value: unknown,
): LegacyImageGenerationCompletion | null {
  const payload = jsonObject(value);
  const rawEvent = jsonObject(payload?.rawEvent);
  const params = jsonObject(rawEvent?.params);
  const item = jsonObject(params?.item);
  const status = imageGenerationStatus(item?.status);
  if (
    payload?.rawType !== "item/completed" ||
    rawEvent?.method !== "item/completed" ||
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

  return {
    callId: item.id,
    error: item.failure === null ? null : "Image generation failed",
    item,
    path: typeof item.savedPath === "string" ? item.savedPath : null,
    prompt: typeof item.revisedPrompt === "string" ? item.revisedPrompt : null,
    status,
    transparentBackground:
      typeof item.transparentBackground === "boolean"
        ? item.transparentBackground
        : false,
  };
}
