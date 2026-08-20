import {
  instructionModeValues,
  permissionEscalationValues,
  reasoningLevelValues,
  runtimePermissionScopeValues,
  threadDiscardParamsSchema as canonicalThreadDiscardParamsSchema,
  threadForkParamsSchema as canonicalThreadForkParamsSchema,
  threadResumeParamsSchema as canonicalThreadResumeParamsSchema,
  threadStartParamsSchema as canonicalThreadStartParamsSchema,
  threadStopParamsSchema as canonicalThreadStopParamsSchema,
  turnStartParamsSchema as canonicalTurnStartParamsSchema,
  turnSteerParamsSchema as canonicalTurnSteerParamsSchema,
  skillsConfigureParamsSchema,
  bridgeRequestEnvelopeSchema,
  experimental_providerMaintenanceParamsSchema,
  experimental_providerInstallationRunParamsSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import { claudePermissionModeSchema } from "../interactive-contract.js";

const bridgeInstructionModeSchema = z.enum(instructionModeValues);
const bridgePermissionEscalationSchema = z
  .enum(permissionEscalationValues)
  .nullable();
const bridgePermissionScopeSchema = z.enum(runtimePermissionScopeValues);
const bridgeReasoningLevelSchema = z.enum(reasoningLevelValues);
// Omission means the session has no extra writable roots; this keeps older
// bridge messages compatible and avoids sending an empty protocol field.
const bridgeAdditionalWorkspaceWriteRootsSchema = z
  .array(z.string())
  .optional();

const bridgeClaudeLocalPluginSchema = z.object({
  type: z.literal("local"),
  path: z.string(),
});
const bridgeClaudePluginsSchema = z
  .array(bridgeClaudeLocalPluginSchema)
  .optional();

const dynamicToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.unknown(),
});

export const claudeThreadStartParamsSchema = z.object({
  threadId: z.string(),
  cwd: z.string(),
  baseInstructions: z.string(),
  additionalWorkspaceWriteRoots: bridgeAdditionalWorkspaceWriteRootsSchema,
  plugins: bridgeClaudePluginsSchema,
  permissionMode: claudePermissionModeSchema,
  // The mode the session returns to once the user approves a plan. `/plan`
  // overrides `permissionMode` for the whole session, so without this the
  // thread would keep Plan mode's gating after the plan is approved and
  // prompt for edits the user's preset already allows. Equal to
  // `permissionMode` whenever the session does not start in Plan mode.
  approvedPlanPermissionMode: claudePermissionModeSchema,
  permissionScope: bridgePermissionScopeSchema,
  permissionEscalation: bridgePermissionEscalationSchema,
  config: z.record(z.string(), z.unknown()).optional(),
  model: z.string().optional(),
  reasoningLevel: bridgeReasoningLevelSchema.optional(),
  workflowsEnabled: z.boolean(),
  memoryEnabled: z.boolean().optional(),
  providerSubagentsEnabled: z.boolean().optional(),
  instructionMode: bridgeInstructionModeSchema,
  dynamicTools: z.array(dynamicToolSchema).optional(),
  disallowedTools: z.array(z.string()).optional(),
});

export const claudeThreadResumeParamsSchema =
  claudeThreadStartParamsSchema.extend({
    providerThreadId: z.string().nullable(),
    baseInstructions: z.string().optional(),
  });

export const claudeThreadForkParamsSchema =
  claudeThreadStartParamsSchema.extend({
    sourceProviderThreadId: z.string(),
    sourceProviderCheckpointId: z.string().min(1).optional(),
    baseInstructions: z.string().optional(),
  });

export const claudeTurnStartParamsSchema = z.object({
  threadId: z.string(),
  providerThreadId: z.string().nullable(),
  input: z.array(z.unknown()),
  model: z.string().optional(),
  reasoningLevel: bridgeReasoningLevelSchema.optional(),
  workflowsEnabled: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  providerSubagentsEnabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  permissionEscalation: bridgePermissionEscalationSchema,
});

export const claudeTurnSteerParamsSchema = z.object({
  threadId: z.string(),
  providerThreadId: z.string().nullable(),
  expectedTurnId: z.string(),
  input: z.array(z.unknown()),
  model: z.string().optional(),
  reasoningLevel: bridgeReasoningLevelSchema.optional(),
  workflowsEnabled: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  providerSubagentsEnabled: z.boolean().optional(),
  permissionEscalation: bridgePermissionEscalationSchema,
});

/** The canonical Provider Bridge Protocol params, per method. */
const claudeCodeCommandSchema = z.discriminatedUnion("method", [
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
    params: z.object({}),
  }),
  z.object({
    method: z.literal("provider/health"),
    params: experimental_providerMaintenanceParamsSchema,
  }),
  z.object({
    method: z.literal("provider/usage"),
    params: experimental_providerMaintenanceParamsSchema,
  }),
  z.object({
    method: z.literal("provider/installation/status"),
    params: experimental_providerMaintenanceParamsSchema,
  }),
  z.object({
    method: z.literal("provider/installation/run"),
    params: experimental_providerInstallationRunParamsSchema,
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

type ClaudeCodeCommand = z.infer<typeof claudeCodeCommandSchema>;

export type ClaudeCodeJsonRpcRequest = ClaudeCodeCommand & {
  jsonrpc: "2.0";
  id: string | number;
};

export type ThreadStartParams = z.infer<typeof claudeThreadStartParamsSchema>;

export type ThreadResumeParams = z.infer<typeof claudeThreadResumeParamsSchema>;

export type ThreadForkParams = z.infer<typeof claudeThreadForkParamsSchema>;

export type TurnStartParams = z.infer<typeof claudeTurnStartParamsSchema>;

export type TurnSteerParams = z.infer<typeof claudeTurnSteerParamsSchema>;

export type ThreadStopParams = z.infer<typeof canonicalThreadStopParamsSchema>;

const claudeCodeCommandMethods = new Set<string>(
  claudeCodeCommandSchema.options.map((option) => option.shape.method.value),
);

/**
 * A decode failure on a well-formed envelope is a caller-visible error, not
 * something to drop: the caller is waiting on `id` and would otherwise learn
 * nothing until its request timed out.
 */
export type ClaudeCodeJsonRpcRequestDecodeResult =
  | { kind: "request"; request: ClaudeCodeJsonRpcRequest }
  | { kind: "not_a_request" }
  | { kind: "unknown_method"; id: string | number; method: string }
  | {
      kind: "invalid_params";
      id: string | number;
      method: string;
      issues: string;
    };

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

export function decodeClaudeCodeJsonRpcRequest(
  raw: unknown,
): ClaudeCodeJsonRpcRequestDecodeResult {
  const envelope = bridgeRequestEnvelopeSchema.safeParse(raw);
  if (!envelope.success) return { kind: "not_a_request" };

  const { id, method } = envelope.data;
  if (!claudeCodeCommandMethods.has(method)) {
    return { kind: "unknown_method", id, method };
  }

  const command = claudeCodeCommandSchema.safeParse({
    method,
    params: envelope.data.params ?? {},
  });
  if (!command.success) {
    return {
      kind: "invalid_params",
      id,
      method,
      issues: formatZodIssues(command.error),
    };
  }

  return {
    kind: "request",
    request: { ...command.data, jsonrpc: "2.0", id },
  };
}
