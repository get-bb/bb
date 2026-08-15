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
});

const providerNativeToolCallRequestSchema = z.object({
  threadId: z.string().min(1),
  // Native provider tool calls use the same required turn id shape as bridge
  // tool calls: null means unresolved and must be resolved by the runtime.
  turnId: z.union([z.string().min(1), z.null()]),
  callId: z.string().min(1),
  tool: z.string().min(1),
  arguments: z.unknown(),
});

export const providerToolCallResponseSchema = z.object({
  success: z.boolean(),
  contentItems: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("inputText"),
        text: z.string(),
      }),
      z.object({
        type: z.literal("inputImage"),
        imageUrl: z.string().min(1),
      }),
    ]),
  ),
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

export function decodeNativeProviderToolCallRequest(
  requestId: string | number,
  method: string,
  params: unknown,
): DecodedToolCallRequest | null {
  if (method !== "item/tool/call") {
    return null;
  }

  const parsed = providerNativeToolCallRequestSchema.safeParse(params);
  if (!parsed.success) {
    return null;
  }

  return {
    requestId,
    providerThreadId: parsed.data.threadId,
    turnId: parsed.data.turnId,
    callId: parsed.data.callId,
    tool: parsed.data.tool,
    ...(parsed.data.arguments !== undefined
      ? { arguments: parsed.data.arguments }
      : {}),
  };
}
