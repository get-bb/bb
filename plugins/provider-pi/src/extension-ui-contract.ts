import { z } from "zod";

export const PI_PLUGIN_ID = "provider-pi";

export const PI_EXTENSION_UI_KIND = `${PI_PLUGIN_ID}/extension-ui`;

export const PI_EXTENSION_UI_RENDERER_ID = "extension-ui";

const PLUGIN_TITLE_MAX = 200;

const dialogMethodSchema = z.enum(["select", "confirm", "input", "editor"]);

const boundedText = (max: number) => z.string().max(max);

export const PI_EXTENSION_UI_MAX_OPTIONS = 64;

const baseExtensionUiRequestSchema = z.object({
  id: z.union([z.string(), z.number()]),
  method: dialogMethodSchema,
  title: boundedText(PLUGIN_TITLE_MAX).refine(
    (value) => value.trim().length > 0,
    "Extension UI title cannot be blank",
  ),
  options: z.array(boundedText(512)).max(PI_EXTENSION_UI_MAX_OPTIONS).optional(),
  message: boundedText(8192).optional(),
  placeholder: boundedText(1024).optional(),
  prefill: boundedText(65536).optional(),
  timeout: z.number().int().positive().optional(),
});

export const piExtensionUiRequestSchema = baseExtensionUiRequestSchema.refine(
  (request) => request.method !== "select" || (request.options?.length ?? 0) > 0,
  { message: "select requests require a non-empty options list" },
);

export type PiExtensionUiRequest = z.infer<typeof piExtensionUiRequestSchema>;

export const piExtensionUiPayloadDataSchema = z.object({
  requestId: z.string().min(1),
  ...baseExtensionUiRequestSchema.pick({
    method: true,
    options: true,
    message: true,
    placeholder: true,
    prefill: true,
  }).shape,
});

export type PiExtensionUiPayloadData = z.infer<
  typeof piExtensionUiPayloadDataSchema
>;

export const piExtensionUiResolutionSchema = z.object({
  kind: z.literal("request_answer"),
  value: z.unknown(),
});

export type PiExtensionUiResolution = z.infer<
  typeof piExtensionUiResolutionSchema
>;

export type PiExtensionUiResponseFields =
  | { value: string }
  | { confirmed: boolean }
  | { cancelled: true };

export interface InteractionUiRequest {
  jsonrpc: "2.0";
  id: string;
  method: "interaction/request";
  params: {
    providerThreadId: string;
    threadId: string;
    turnId: null;
    payload: {
      kind: typeof PI_EXTENSION_UI_KIND;
      title: string;
      data: PiExtensionUiPayloadData;
    };
  };
}

export type RuntimeInteractionUiResponse = {
  id: string | number;
  result?: unknown;
  error?: { message?: string };
};

export function resolveExtensionUiResponseFields(
  request: PiExtensionUiRequest,
  result: PiExtensionUiResolution,
): PiExtensionUiResponseFields {
  const { value } = result;
  if (request.method === "confirm") {
    return typeof value === "boolean"
      ? { confirmed: value }
      : { cancelled: true };
  }
  if (typeof value !== "string") {
    return { cancelled: true };
  }
  if (request.method === "select" && !request.options?.includes(value)) {
    return { cancelled: true };
  }
  return { value };
}
