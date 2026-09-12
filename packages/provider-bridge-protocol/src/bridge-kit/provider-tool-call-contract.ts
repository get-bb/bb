import { toolCallRequestParamsSchema } from "../bridge-requests.js";
import type { DecodedToolCallRequest } from "./contracts.js";

export function decodeNormalizedProviderToolCallRequest(
  requestId: string | number,
  method: string,
  params: unknown,
): DecodedToolCallRequest | null {
  if (method !== "item/tool/call") {
    return null;
  }

  const parsed = toolCallRequestParamsSchema.safeParse(params);
  if (!parsed.success) {
    return null;
  }

  return {
    requestId,
    providerThreadId: parsed.data.providerThreadId,
    turnId: parsed.data.turnId,
    callId: parsed.data.callId,
    tool: parsed.data.tool,
    ...(parsed.data.arguments !== undefined
      ? { arguments: parsed.data.arguments }
      : {}),
    ...(parsed.data.threadId ? { threadId: parsed.data.threadId } : {}),
  };
}
