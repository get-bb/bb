import { z } from "zod";

type BridgeJsonRpcValue =
  | string
  | number
  | boolean
  | null
  | readonly BridgeJsonRpcValue[]
  | { readonly [key: string]: BridgeJsonRpcValue };

const bridgeJsonRpcValueSchema: z.ZodType<BridgeJsonRpcValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(bridgeJsonRpcValueSchema).readonly(),
    z.record(z.string(), bridgeJsonRpcValueSchema),
  ]),
);

type BridgeToolCallArguments = {
  readonly [key: string]: BridgeJsonRpcValue;
};

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
    arguments: BridgeToolCallArguments;
  };
}

export const bridgeRequestEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const jsonRpcErrorSchema = z.object({
  code: z.number(),
  message: z.string().optional(),
  data: z.unknown().optional(),
});

const jsonRpcSuccessResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: bridgeJsonRpcValueSchema,
});

const jsonRpcErrorResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  error: jsonRpcErrorSchema,
});

export type BridgeJsonRpcResponse =
  | z.infer<typeof jsonRpcSuccessResponseSchema>
  | z.infer<typeof jsonRpcErrorResponseSchema>;

export function decodeBridgeJsonRpcResponse(
  input: BridgeJsonRpcValue,
): BridgeJsonRpcResponse | null {
  if (bridgeRequestEnvelopeSchema.safeParse(input).success) return null;

  const error = jsonRpcErrorResponseSchema.safeParse(input);
  if (error.success) return error.data;

  const success = jsonRpcSuccessResponseSchema.safeParse(input);
  return success.success ? success.data : null;
}

export interface BridgeToolCallImage {
  data: string;
  mimeType: string;
}

export type BridgeToolCallContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface DecodedToolCallResponse {
  content: string;
  contentBlocks: BridgeToolCallContent[];
  images: BridgeToolCallImage[];
  isError: boolean;
}

const IMAGE_DATA_URL = /^data:(.+);base64,(.+)$/s;

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

export function decodeToolCallResponsePayload(
  result: BridgeJsonRpcValue,
): DecodedToolCallResponse {
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
    content: text,
    contentBlocks,
    images,
    isError,
  };
}

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
