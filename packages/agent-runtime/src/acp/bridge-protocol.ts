/**
 * Wire contract between the agent runtime and the ACP bridge process.
 *
 * The runtime sends the JSON-RPC requests produced by the ACP adapter's
 * `buildCommandPlan`; the bridge answers them and streams the notifications
 * below back over stdout. Both sides import these schemas so the contract has
 * a single source of truth.
 */

import {
  permissionEscalationSchema,
  permissionModeSchema,
  promptInputSchema,
  reasoningLevelSchema,
  serviceTierSchema,
} from "@bb/domain";
import { z } from "zod";
import {
  acpPermissionOptionSchema,
  acpSessionUpdateSchema,
  acpStopReasonSchema,
  acpToolKindSchema,
} from "./wire.js";

// ---------------------------------------------------------------------------
// Runtime → bridge commands
// ---------------------------------------------------------------------------

export const acpBridgeAgentCommandSchema = z.object({
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

const acpBridgeModelListParamsSchema = z.object({
  /**
   * Command whose stdout lists one `id - Display Name` line per model. The
   * bridge groups the ids into model families with reasoning-effort variants
   * (see `bridge/model-catalog.ts`), falling back to the synthetic "Agent
   * default" entry when the command fails or lists nothing. Optional so a
   * minimal `model/list` (e.g. the packaged-bridge smoke test, which has no
   * agent binary) still gets a valid synthetic response instead of hanging.
   */
  listCommand: acpBridgeAgentCommandSchema.optional(),
  /**
   * ACP-native model discovery command. Used only when `listCommand` is
   * absent: the bridge starts a throwaway session and reads the model select
   * from the `session/new` result's config state.
   */
  agent: acpBridgeAgentCommandSchema.optional(),
  /**
   * Family ids served in the picker's default list; the rest become
   * selected-only "more models". No matches (or an empty list) serves
   * everything as primary.
   */
  primaryModels: z.array(z.string()).default([]),
});

/**
 * Session-level model pin. CLI-style agents resolve (model, reasoningLevel,
 * serviceTier) to a raw model id and launch with `<selectFlag> <resolved-id>`.
 * ACP-native agents receive `{ modelId }` after `session/new` via
 * `session/set_model`; if they expose a `thought_level` config option, the
 * bridge applies `reasoningLevel` via `session/set_config_option`. Absent when
 * the thread has no model preference.
 */
const acpBridgeCliModelSelectionSchema = z.object({
  listCommand: acpBridgeAgentCommandSchema,
  selectFlag: z.string().min(1),
  model: z.string().min(1),
  reasoningLevel: reasoningLevelSchema.optional(),
  serviceTier: serviceTierSchema.optional(),
});

const acpBridgeNativeModelSelectionSchema = z.object({
  modelId: z.string().min(1),
  reasoningLevel: reasoningLevelSchema.optional(),
});

const acpBridgeModelSelectionSchema = z.union([
  acpBridgeCliModelSelectionSchema,
  acpBridgeNativeModelSelectionSchema,
]);
export type AcpBridgeModelSelection = z.infer<
  typeof acpBridgeModelSelectionSchema
>;

const acpBridgeSessionParamsSchema = z.object({
  threadId: z.string().min(1),
  cwd: z.string().min(1),
  agent: acpBridgeAgentCommandSchema,
  modelSelection: acpBridgeModelSelectionSchema.optional(),
  permissionMode: permissionModeSchema,
  permissionEscalation: permissionEscalationSchema.nullable(),
  /** Roots (workspace plus configured extras) where client fs writes are allowed. */
  workspaceWriteRoots: z.array(z.string()),
  envVars: z.record(z.string(), z.string()).optional(),
  /** Server-owned instructions; prepended to the session's first prompt. */
  instructions: z.string().optional(),
});

export const acpBridgeThreadStartParamsSchema = acpBridgeSessionParamsSchema;
export type AcpBridgeThreadStartParams = z.infer<
  typeof acpBridgeThreadStartParamsSchema
>;

export const acpBridgeThreadResumeParamsSchema =
  acpBridgeSessionParamsSchema.extend({
    providerThreadId: z.string().min(1),
  });
export type AcpBridgeThreadResumeParams = z.infer<
  typeof acpBridgeThreadResumeParamsSchema
>;

export const acpBridgeTurnStartParamsSchema = z.object({
  threadId: z.string().min(1),
  input: z.array(promptInputSchema),
});

export const acpBridgeTurnSteerParamsSchema = z.object({
  threadId: z.string().min(1),
  expectedTurnId: z.string().min(1),
  input: z.array(promptInputSchema),
});

export const acpBridgeThreadStopParamsSchema = z.object({
  threadId: z.string().min(1),
});

export const acpBridgeCommandSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("initialize"),
    params: z.object({
      clientInfo: z.object({ name: z.string(), version: z.string() }),
    }),
  }),
  z.object({
    method: z.literal("model/list"),
    params: acpBridgeModelListParamsSchema,
  }),
  z.object({
    method: z.literal("thread/start"),
    params: acpBridgeThreadStartParamsSchema,
  }),
  z.object({
    method: z.literal("thread/resume"),
    params: acpBridgeThreadResumeParamsSchema,
  }),
  z.object({
    method: z.literal("turn/start"),
    params: acpBridgeTurnStartParamsSchema,
  }),
  z.object({
    method: z.literal("turn/steer"),
    params: acpBridgeTurnSteerParamsSchema,
  }),
  z.object({
    method: z.literal("thread/stop"),
    params: acpBridgeThreadStopParamsSchema,
  }),
]);
export type AcpBridgeCommand = z.infer<typeof acpBridgeCommandSchema>;

// ---------------------------------------------------------------------------
// Bridge → runtime notifications
// ---------------------------------------------------------------------------

export const ACP_TURN_STARTED_METHOD = "acp/turn/started";
export const ACP_TURN_COMPLETED_METHOD = "acp/turn/completed";
export const ACP_UPDATE_METHOD = "acp/update";
export const ACP_FS_WRITE_METHOD = "acp/fs/write";
export const ACP_WARNING_METHOD = "acp/warning";

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
    diff: z.string().optional(),
  })
  .passthrough();

export const acpWarningNotificationParamsSchema = z
  .object({
    threadId: z.string().min(1),
    summary: z.string().min(1),
    details: z.string().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Bridge → runtime permission requests
// ---------------------------------------------------------------------------

export const ACP_PERMISSION_REQUEST_METHOD = "acp/permission/request";

export const acpPermissionRequestParamsSchema = z.object({
  threadId: z.string().min(1),
  providerThreadId: z.string().min(1),
  turnId: z.union([z.string().min(1), z.null()]),
  toolCall: z
    .object({
      toolCallId: z.string().min(1),
      title: z.string().optional(),
      kind: acpToolKindSchema.optional(),
      command: z.string().optional(),
    })
    .optional(),
  options: z.array(acpPermissionOptionSchema).min(1),
});
export type AcpPermissionRequestParams = z.infer<
  typeof acpPermissionRequestParamsSchema
>;

/**
 * The runtime answers a permission request with the user's decision; the
 * bridge maps it back onto the ACP options it kept for the pending request.
 */
export const acpPermissionResponseSchema = z.object({
  decision: z.enum(["allow_once", "allow_for_session", "deny"]),
});
export type AcpPermissionResponse = z.infer<typeof acpPermissionResponseSchema>;
