import {
  pendingInteractionPayloadSchema,
  pendingInteractionResolutionSchema,
} from "@bb/domain";
import { z } from "zod";

/**
 * Bridge → runtime requests: the two channels where the provider needs an
 * answer from bb mid-turn. Both carry canonical bb shapes — the bridge maps
 * its provider's native forms in both directions.
 */
export const BRIDGE_INBOUND_REQUEST_METHODS = {
  toolCall: "item/tool/call",
  interactionRequest: "interaction/request",
} as const;

export type BridgeInboundRequestMethod =
  (typeof BRIDGE_INBOUND_REQUEST_METHODS)[keyof typeof BRIDGE_INBOUND_REQUEST_METHODS];

/**
 * A dynamic (plugin-contributed) tool call. `turnId` is the bridge-minted
 * turn id when known; null means unresolved — the runtime resolves it from
 * the active turn. An empty string is malformed.
 */
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

export type ToolCallRequestParams = z.infer<typeof toolCallRequestParamsSchema>;

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

export type ToolCallResult = z.infer<typeof toolCallResultSchema>;

/**
 * An interactive request (permission approval, user question, plan-mode
 * exit). The payload is the canonical `PendingInteractionPayload` union from
 * `@bb/domain`; the response is the canonical resolution. Provider-specific
 * request/response dialects never cross this boundary.
 */
export const interactionRequestParamsSchema = z
  .object({
    providerThreadId: z.string().min(1),
    threadId: z.string().min(1).optional(),
    turnId: z.union([z.string().min(1), z.null()]),
    payload: pendingInteractionPayloadSchema,
    /**
     * The request's turn id and approval-subject item ids are in the
     * provider's native id space (a `thread/delta` bridge holds no bb ids):
     * the runtime adapter translates them through the delta assembler's maps
     * before the interaction reaches the app. Omission means the ids are
     * already app-visible (bridges whose approval subjects never referenced
     * timeline ids — ACP's approval ids never matched timeline ids).
     */
    providerNativeIds: z.boolean().optional(),
  })
  .passthrough();

export type InteractionRequestParams = z.infer<
  typeof interactionRequestParamsSchema
>;

export const interactionResolutionResultSchema =
  pendingInteractionResolutionSchema;
