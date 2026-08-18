/**
 * The ACP bridge's own vocabulary: the canonical requests it accepts, and the
 * `acp/*` envelopes it feeds its session translator. The envelopes never reach
 * the wire — the translator turns them into `thread/delta` semantic deltas —
 * but they are a real contract between the bridge and its translator, which is
 * why they are schemas rather than ad-hoc objects.
 */

import {
  acpPermissionCliSchema as acpBridgePermissionCliSchema,
  acpNativeReasoningSchema as acpBridgeNativeReasoningSchema,
  acpReasoningCliSchema as acpBridgeReasoningCliSchema,
  modelListParamsSchema as canonicalModelListParamsSchema,
  threadDiscardParamsSchema as canonicalThreadDiscardParamsSchema,
  threadForkParamsSchema as canonicalThreadForkParamsSchema,
  threadResumeParamsSchema as canonicalThreadResumeParamsSchema,
  threadStartParamsSchema as canonicalThreadStartParamsSchema,
  threadStopParamsSchema as canonicalThreadStopParamsSchema,
  turnStartParamsSchema as canonicalTurnStartParamsSchema,
  turnSteerParamsSchema as canonicalTurnSteerParamsSchema,
  skillsConfigureParamsSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import { acpSessionUpdateSchema, acpStopReasonSchema } from "./wire.js";

// ---------------------------------------------------------------------------
// Runtime → bridge commands
// ---------------------------------------------------------------------------

const acpBridgeAgentCommandSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()),
  cwd: z.string().min(1).optional(),
  envVars: z.record(z.string(), z.string()).optional(),
});
export type AcpBridgeAgentCommand = z.infer<typeof acpBridgeAgentCommandSchema>;

/**
 * Id of the synthetic "Agent default" model the bridge serves when the agent's
 * model list cannot be read. Never forwarded to the agent.
 */
export const ACP_DEFAULT_MODEL_ID = "acp-default";

export type AcpBridgeReasoningCli = z.infer<typeof acpBridgeReasoningCliSchema>;

export type AcpBridgeNativeReasoning = z.infer<
  typeof acpBridgeNativeReasoningSchema
>;

export type AcpBridgePermissionCli = z.infer<
  typeof acpBridgePermissionCliSchema
>;

/**
 * `model/list` as sent by the generic bridge-protocol adapter: the base
 * canonical shape plus the provider-scoped options bag the acp bridge reads
 * its launch spec from.
 */
const acpModelListParamsSchema = canonicalModelListParamsSchema.extend({
  providerOptions: z.record(z.string(), z.unknown()).optional(),
});

/** The canonical Provider Bridge Protocol params, per method. */
export const acpBridgeCommandSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("initialize"),
    params: z
      .object({
        protocolVersion: z.number().int().positive(),
        client: z.object({ name: z.string(), version: z.string() }),
      })
      .passthrough(),
  }),
  z.object({
    method: z.literal("model/list"),
    params: acpModelListParamsSchema,
  }),
  z.object({
    method: z.literal("thread/start"),
    params: canonicalThreadStartParamsSchema,
  }),
  z.object({
    method: z.literal("thread/resume"),
    params: canonicalThreadResumeParamsSchema,
  }),
  z.object({
    method: z.literal("thread/fork"),
    params: canonicalThreadForkParamsSchema,
  }),
  z.object({
    method: z.literal("turn/start"),
    params: canonicalTurnStartParamsSchema,
  }),
  z.object({
    method: z.literal("turn/steer"),
    params: canonicalTurnSteerParamsSchema,
  }),
  z.object({
    method: z.literal("thread/stop"),
    params: canonicalThreadStopParamsSchema,
  }),
  z.object({
    method: z.literal("thread/discard"),
    params: canonicalThreadDiscardParamsSchema,
  }),
  z.object({
    method: z.literal("skills/configure"),
    params: skillsConfigureParamsSchema,
  }),
]);

/**
 * The known-method set, derived from the schema union so it cannot drift
 * (#853): the bridge answers unknown methods with METHOD_NOT_FOUND and
 * schema-invalid params with INVALID_PARAMS instead of dropping them.
 */
export const acpBridgeCommandMethodValues = acpBridgeCommandSchema.options.map(
  (option) => option.shape.method.value,
);
export type AcpBridgeCommand = z.infer<typeof acpBridgeCommandSchema>;

// ---------------------------------------------------------------------------
// Bridge → runtime notifications
// ---------------------------------------------------------------------------

export const ACP_TURN_STARTED_METHOD = "acp/turn/started";
export const ACP_TURN_COMPLETED_METHOD = "acp/turn/completed";
/**
 * Manual compaction's own turn envelope. bb requests compaction as a
 * standalone builtin `/compact` mention on the turn path; the bridge runs it
 * as a provider-local maintenance prompt and reports it with these two
 * envelopes so the translator can emit a `contextCompaction` turn instead of
 * an ordinary agent turn.
 */
export const ACP_COMPACTION_STARTED_METHOD = "acp/compaction/started";
export const ACP_COMPACTION_COMPLETED_METHOD = "acp/compaction/completed";
export const ACP_UPDATE_METHOD = "acp/update";
export const ACP_FS_WRITE_METHOD = "acp/fs/write";
export const ACP_WARNING_METHOD = "acp/warning";

/** The bridge has a session, but its agent prompt has already ended. */
export const ACP_BRIDGE_NO_ACTIVE_TURN_ERROR_CODE = -32001;

export const acpTurnStartedNotificationParamsSchema = z
  .object({
    threadId: z.string().min(1),
  })
  .passthrough();

export const acpTurnCompletedNotificationParamsSchema = z
  .object({
    threadId: z.string().min(1),
    stopReason: acpStopReasonSchema,
  })
  .passthrough();

export const acpCompactionCompletedNotificationParamsSchema =
  z.discriminatedUnion("status", [
    z
      .object({
        threadId: z.string().min(1),
        status: z.literal("completed"),
      })
      .passthrough(),
    z
      .object({
        threadId: z.string().min(1),
        status: z.literal("interrupted"),
      })
      .passthrough(),
    z
      .object({
        threadId: z.string().min(1),
        status: z.literal("failed"),
        error: z.string().min(1),
      })
      .passthrough(),
  ]);

export const acpUpdateNotificationParamsSchema = z
  .object({
    threadId: z.string().min(1),
    update: acpSessionUpdateSchema,
  })
  .passthrough();

export const acpFsWriteNotificationParamsSchema = z
  .object({
    threadId: z.string().min(1),
    path: z.string().min(1),
    kind: z.enum(["add", "update"]),
    /** Absent on `add`: the file did not exist before the write. */
    oldText: z.string().optional(),
    /** The written file content; the assembler builds the diff from it. */
    content: z.string(),
  })
  .passthrough();

export const acpWarningNotificationParamsSchema = z
  .object({
    threadId: z.string().min(1),
    summary: z.string().min(1),
    details: z.string().optional(),
  })
  .passthrough();
