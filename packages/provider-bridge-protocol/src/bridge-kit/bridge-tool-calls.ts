/**
 * Shared tool call helpers for bridge processes.
 *
 * Both claude-code and pi bridges forward tool calls from the provider SDK
 * to the host-daemon and feed responses back. This module provides:
 * - The JSON-RPC request type for forwarding tool calls
 * - Response decoding for tool call results from the host-daemon
 * - Generic JSON-RPC response decoding (for matching tool call responses)
 */

import { z } from "zod";

/** Kit-internal: the runtime's `item/tool/call` response result shape. */
const providerToolCallResponseSchema = z.object({
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

// ---------------------------------------------------------------------------
// Tool call request — bridge → host-daemon
// ---------------------------------------------------------------------------

export interface BridgeToolCallRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: "item/tool/call";
  params: {
    providerThreadId: string;
    threadId?: string;
    turnId: string | null;
    callId: string;
    tool: string;
    arguments: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// JSON-RPC envelope schema — shared by both bridges for request decoding
// ---------------------------------------------------------------------------

export const bridgeRequestEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// JSON-RPC response decoding — host-daemon → bridge
// ---------------------------------------------------------------------------

const jsonRpcErrorSchema = z.object({
  code: z.number(),
  message: z.string().optional(),
  data: z.unknown().optional(),
});

const jsonRpcSuccessResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: z.unknown(),
});

const jsonRpcErrorResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  error: jsonRpcErrorSchema,
});

export type BridgeJsonRpcResponse =
  | z.infer<typeof jsonRpcSuccessResponseSchema>
  | z.infer<typeof jsonRpcErrorResponseSchema>;

/**
 * Requests and responses share one id space on the bidirectional bridge
 * channel: both sides number their outgoing requests with a plain counter from
 * 1. `method` is what tells them apart — a response never carries one. Without
 * this check an inbound request whose id collides with an outstanding outgoing
 * request decodes as a success response (the schemas are non-strict and
 * `result: z.unknown()` also accepts a missing key), so the bridge settles the
 * wrong promise and drops the request without replying, leaving the caller to
 * time out 30s later with no diagnostic.
 */
function isJsonRpcRequest(input: unknown): boolean {
  return (
    typeof input === "object" &&
    input !== null &&
    "method" in input &&
    input.method !== undefined
  );
}

export function decodeBridgeJsonRpcResponse(
  input: unknown,
): BridgeJsonRpcResponse | null {
  if (isJsonRpcRequest(input)) return null;

  const error = jsonRpcErrorResponseSchema.safeParse(input);
  if (error.success) return error.data;

  const success = jsonRpcSuccessResponseSchema.safeParse(input);
  return success.success ? success.data : null;
}

// ---------------------------------------------------------------------------
// Tool call response payload decoding
// ---------------------------------------------------------------------------

export function decodeToolCallResponsePayload(result: unknown): {
  content: string;
  isError: boolean;
} {
  const parsed = providerToolCallResponseSchema.safeParse(result);
  if (!parsed.success) {
    return { content: "OK", isError: false };
  }

  const text = parsed.data.contentItems
    .filter((item) => item.type === "inputText")
    .map((item) => (item as { type: "inputText"; text: string }).text)
    .join("\n");

  return {
    content: text || "OK",
    isError: !parsed.data.success,
  };
}
