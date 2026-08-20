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

/** An image on a tool call result, split out of an `inputImage` data URL. */
export interface BridgeToolCallImage {
  data: string;
  mimeType: string;
}

/**
 * A tool result block in the one shape every consumer already accepts: MCP's
 * `CallToolResult.content` (claude-code and acp) and pi's `AgentToolResult.content`
 * declare the same two members with the same field names.
 */
export type BridgeToolCallContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

const IMAGE_DATA_URL = /^data:(.+);base64,(.+)$/s;

/**
 * Splits `data:<mime>;base64,<data>` into the parts a tool result carries.
 * Returns null for any other URL: both result contracts carry inline base64 and
 * have nowhere to put a remote reference, so the caller keeps such a URL as text
 * rather than dropping it.
 */
function decodeImageDataUrl(imageUrl: string): BridgeToolCallImage | null {
  const match = IMAGE_DATA_URL.exec(imageUrl);
  if (match === null) {
    return null;
  }
  const [, mimeType, data] = match;
  if (data.length === 0) {
    return null;
  }
  return { data, mimeType };
}

export function decodeToolCallResponsePayload(result: unknown): {
  content: string;
  contentBlocks: BridgeToolCallContent[];
  images: BridgeToolCallImage[];
  isError: boolean;
} {
  const parsed = providerToolCallResponseSchema.safeParse(result);
  if (!parsed.success) {
    return {
      content: "Invalid tool call response",
      contentBlocks: [{ type: "text", text: "Invalid tool call response" }],
      images: [],
      isError: true,
    };
  }

  const texts: string[] = [];
  const contentBlocks: BridgeToolCallContent[] = [];
  const images: BridgeToolCallImage[] = [];
  for (const item of parsed.data.contentItems) {
    if (item.type === "inputText") {
      texts.push(item.text);
      if (item.text !== "") {
        contentBlocks.push({ type: "text", text: item.text });
      }
      continue;
    }
    const image = decodeImageDataUrl(item.imageUrl);
    if (image === null) {
      texts.push(item.imageUrl);
      contentBlocks.push({ type: "text", text: item.imageUrl });
      continue;
    }
    images.push(image);
    contentBlocks.push({ type: "image", ...image });
  }

  const text = texts.join("\n");
  const isError = !parsed.data.success;
  if (contentBlocks.length === 0) {
    const fallback = isError ? "Tool call failed" : "OK";
    return {
      content: fallback,
      contentBlocks: [{ type: "text", text: fallback }],
      images,
      isError,
    };
  }
  return {
    // Keep the legacy aggregate fields for provider bridges that already use
    // this published helper. New consumers use contentBlocks so interleaved
    // text and images retain the plugin result's order.
    content: text,
    contentBlocks,
    images,
    isError,
  };
}

/**
 * Renders a decoded payload as tool result blocks, dropping empty text so an
 * image-only result carries the image alone.
 */
export function buildBridgeToolCallContent(result: {
  content: string;
  contentBlocks?: BridgeToolCallContent[];
  images?: BridgeToolCallImage[];
}): BridgeToolCallContent[] {
  if (result.contentBlocks !== undefined) {
    return result.contentBlocks;
  }
  const blocks: BridgeToolCallContent[] = [];
  if (result.content !== "") {
    blocks.push({ type: "text", text: result.content });
  }
  for (const image of result.images ?? []) {
    blocks.push({ type: "image", data: image.data, mimeType: image.mimeType });
  }
  return blocks;
}
