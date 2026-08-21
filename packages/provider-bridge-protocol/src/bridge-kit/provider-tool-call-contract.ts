import { z } from "zod";
import type { DecodedToolCallRequest } from "./contracts.js";

const normalizedToolCallRequestSchema = z.object({
  providerThreadId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  // Canonical bridge wire form: required string when known, required null when
  // the provider cannot resolve the BB turn id itself.
  turnId: z.union([z.string().min(1), z.null()]),
  callId: z.string().min(1),
  tool: z.string().min(1),
  arguments: z.unknown(),
  /**
   * turnId/callId are provider-native (thread/delta bridges hold no bb ids);
   * the runtime adapter translates them through the delta assembler's maps.
   */
  providerNativeIds: z.boolean().optional(),
});

export function decodeNormalizedProviderToolCallRequest(
  requestId: string | number,
  method: string,
  params: unknown,
): DecodedToolCallRequest | null {
  if (method !== "item/tool/call") {
    return null;
  }

  const parsed = normalizedToolCallRequestSchema.safeParse(params);
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
