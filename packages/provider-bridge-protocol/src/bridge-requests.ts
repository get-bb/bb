import { pendingInteractionPayloadSchema } from "@bb/domain";
import { z } from "zod";

export const BRIDGE_INBOUND_REQUEST_METHODS = {
  toolCall: "item/tool/call",
  interactionRequest: "interaction/request",
  urlElicitation: "elicitation/url",
} as const;

export const URL_ELICITATION_ID_MAX_LENGTH = 256;
export const URL_ELICITATION_MESSAGE_MAX_LENGTH = 2_048;
export const URL_ELICITATION_URL_MAX_LENGTH = 8_192;
export const URL_ELICITATION_TIMEOUT_MAX_MS = 5 * 60 * 1_000;

const httpUrlSchema = z
  .string()
  .url()
  .max(URL_ELICITATION_URL_MAX_LENGTH)
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  }, "URL elicitation requires an HTTP(S) URL");

export const urlElicitationRequestParamsSchema = z
  .object({
    providerThreadId: z.string().min(1),
    threadId: z.string().min(1).optional(),
    elicitationId: z.string().min(1).max(URL_ELICITATION_ID_MAX_LENGTH),
    message: z.string().min(1).max(URL_ELICITATION_MESSAGE_MAX_LENGTH),
    url: httpUrlSchema,
    timeoutMs: z.number().int().positive().max(URL_ELICITATION_TIMEOUT_MAX_MS),
  })
  .strict();

export const urlElicitationResponseSchema = z
  .object({ action: z.enum(["accept", "decline", "cancel"]) })
  .strict();

export type UrlElicitationRequestParams = z.infer<
  typeof urlElicitationRequestParamsSchema
>;
export type UrlElicitationResponse = z.infer<
  typeof urlElicitationResponseSchema
>;

export const toolCallRequestParamsSchema = z
  .object({
    providerThreadId: z.string().min(1),
    threadId: z.string().min(1).optional(),
    turnId: z.union([z.string().min(1), z.null()]),
    callId: z.string().min(1),
    tool: z.string().min(1),
    arguments: z.unknown(),
  })
  .passthrough();

export const toolCallResultSchema = z
  .object({
    success: z.boolean(),
    contentItems: z.array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("inputText"), text: z.string() }),
        z.object({
          type: z.literal("inputImage"),
          imageUrl: z.string().min(1),
        }),
      ]),
    ),
  })
  .passthrough();

export const interactionRequestParamsSchema = z
  .object({
    providerThreadId: z.string().min(1),
    threadId: z.string().min(1).optional(),
    turnId: z.union([z.string().min(1), z.null()]),
    payload: pendingInteractionPayloadSchema,
    providerNativeIds: z.boolean().optional(),
  })
  .passthrough();

export type InteractionRequestParams = z.infer<
  typeof interactionRequestParamsSchema
>;
