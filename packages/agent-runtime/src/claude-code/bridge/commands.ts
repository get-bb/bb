import {
  claudeCodeMockCliTrafficConfigSchema,
  instructionModeValues,
  permissionEscalationValues,
  reasoningLevelValues,
  runtimePermissionScopeValues,
} from "@bb/domain";
import { z } from "zod";
import { jsonRpcEnvelopeSchema } from "../../shared/bridge-tool-calls.js";
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

const claudeCodeCommandSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("initialize"),
    params: z.object({
      clientInfo: z.object({ name: z.string(), version: z.string() }),
    }),
  }),
  z.object({
    method: z.literal("model/list"),
    params: z.object({}),
  }),
  z.object({
    method: z.literal("thread/start"),
    params: z.object({
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
      claudeCodeMockCliTraffic: claudeCodeMockCliTrafficConfigSchema,
      model: z.string().optional(),
      reasoningLevel: bridgeReasoningLevelSchema.optional(),
      workflowsEnabled: z.boolean(),
      memoryEnabled: z.boolean().optional(),
      providerSubagentsEnabled: z.boolean().optional(),
      instructionMode: bridgeInstructionModeSchema,
      dynamicTools: z.array(dynamicToolSchema).optional(),
      disallowedTools: z.array(z.string()).optional(),
    }),
  }),
  z.object({
    method: z.literal("thread/resume"),
    params: z.object({
      threadId: z.string(),
      cwd: z.string(),
      providerThreadId: z.string().nullable(),
      baseInstructions: z.string().optional(),
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
      claudeCodeMockCliTraffic: claudeCodeMockCliTrafficConfigSchema,
      model: z.string().optional(),
      reasoningLevel: bridgeReasoningLevelSchema.optional(),
      workflowsEnabled: z.boolean(),
      memoryEnabled: z.boolean().optional(),
      providerSubagentsEnabled: z.boolean().optional(),
      instructionMode: bridgeInstructionModeSchema,
      dynamicTools: z.array(dynamicToolSchema).optional(),
      disallowedTools: z.array(z.string()).optional(),
    }),
  }),
  z.object({
    method: z.literal("thread/fork"),
    params: z.object({
      threadId: z.string(),
      cwd: z.string(),
      sourceProviderThreadId: z.string(),
      sourceProviderCheckpointId: z.string().min(1).optional(),
      baseInstructions: z.string().optional(),
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
      claudeCodeMockCliTraffic: claudeCodeMockCliTrafficConfigSchema,
      model: z.string().optional(),
      reasoningLevel: bridgeReasoningLevelSchema.optional(),
      workflowsEnabled: z.boolean(),
      memoryEnabled: z.boolean().optional(),
      providerSubagentsEnabled: z.boolean().optional(),
      instructionMode: bridgeInstructionModeSchema,
      dynamicTools: z.array(dynamicToolSchema).optional(),
      disallowedTools: z.array(z.string()).optional(),
    }),
  }),
  z.object({
    method: z.literal("turn/start"),
    params: z.object({
      threadId: z.string(),
      providerThreadId: z.string().nullable(),
      input: z.array(z.unknown()),
      inputGroups: z.array(z.array(z.unknown()).min(1)).optional(),
      model: z.string().optional(),
      reasoningLevel: bridgeReasoningLevelSchema.optional(),
      workflowsEnabled: z.boolean().optional(),
      memoryEnabled: z.boolean().optional(),
      providerSubagentsEnabled: z.boolean().optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      permissionEscalation: bridgePermissionEscalationSchema,
    }),
  }),
  z.object({
    method: z.literal("turn/steer"),
    params: z.object({
      threadId: z.string(),
      providerThreadId: z.string().nullable(),
      expectedTurnId: z.string(),
      input: z.array(z.unknown()),
      inputGroups: z.array(z.array(z.unknown()).min(1)).optional(),
      model: z.string().optional(),
      reasoningLevel: bridgeReasoningLevelSchema.optional(),
      workflowsEnabled: z.boolean().optional(),
      memoryEnabled: z.boolean().optional(),
      providerSubagentsEnabled: z.boolean().optional(),
      permissionEscalation: bridgePermissionEscalationSchema,
    }),
  }),
  z.object({
    method: z.literal("thread/stop"),
    params: z.object({
      threadId: z.string(),
    }),
  }),
]);

type ClaudeCodeCommand = z.infer<typeof claudeCodeCommandSchema>;

export type ClaudeCodeJsonRpcRequest = ClaudeCodeCommand & {
  jsonrpc: "2.0";
  id: string | number;
};

export type ThreadStartParams = Extract<
  ClaudeCodeCommand,
  { method: "thread/start" }
>["params"];

export type ThreadResumeParams = Extract<
  ClaudeCodeCommand,
  { method: "thread/resume" }
>["params"];

export type ThreadForkParams = Extract<
  ClaudeCodeCommand,
  { method: "thread/fork" }
>["params"];

export type TurnStartParams = Extract<
  ClaudeCodeCommand,
  { method: "turn/start" }
>["params"];

export type TurnSteerParams = Extract<
  ClaudeCodeCommand,
  { method: "turn/steer" }
>["params"];

export type ThreadStopParams = Extract<
  ClaudeCodeCommand,
  { method: "thread/stop" }
>["params"];

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
  const envelope = jsonRpcEnvelopeSchema.safeParse(raw);
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
