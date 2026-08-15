import {
  claudeCodeMockCliTrafficConfigSchema,
  instructionModeValues,
  permissionEscalationValues,
  reasoningLevelValues,
  runtimePermissionScopeValues,
} from "@bb/domain";
import {
  threadDiscardParamsSchema as canonicalThreadDiscardParamsSchema,
  threadForkParamsSchema as canonicalThreadForkParamsSchema,
  threadResumeParamsSchema as canonicalThreadResumeParamsSchema,
  threadStartParamsSchema as canonicalThreadStartParamsSchema,
  threadStopParamsSchema as canonicalThreadStopParamsSchema,
  turnStartParamsSchema as canonicalTurnStartParamsSchema,
  turnSteerParamsSchema as canonicalTurnSteerParamsSchema,
} from "@bb/provider-bridge-protocol";
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
  claudeCodeMockCliTraffic: claudeCodeMockCliTrafficConfigSchema,
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
  inputGroups: z.array(z.array(z.unknown()).min(1)).optional(),
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
  inputGroups: z.array(z.array(z.unknown()).min(1)).optional(),
  model: z.string().optional(),
  reasoningLevel: bridgeReasoningLevelSchema.optional(),
  workflowsEnabled: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  providerSubagentsEnabled: z.boolean().optional(),
  permissionEscalation: bridgePermissionEscalationSchema,
});

export const claudeThreadStopParamsSchema = z.object({
  threadId: z.string(),
});

/**
 * Per-method params accept both dialects during the phase-2c migration: the
 * canonical Provider Bridge Protocol shapes (imported from
 * `@bb/provider-bridge-protocol`, listed first — required fields such as
 * `options` or `intent` discriminate them from the legacy shapes) and the
 * legacy adapter shapes. Handlers narrow on the same fields. `model/list`
 * keeps one schema: the canonical params parse under the legacy `{}` shape.
 */
const claudeCodeCommandSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("initialize"),
    // Accepts both the canonical Provider Bridge Protocol shape
    // ({protocolVersion, client}) and the legacy shape ({clientInfo}); the
    // reply is always the canonical handshake, which the legacy adapter
    // ignores.
    params: z.union([
      z
        .object({
          protocolVersion: z.number().int().positive(),
          client: z.object({ name: z.string(), version: z.string() }),
        })
        .passthrough(),
      z.object({
        clientInfo: z.object({ name: z.string(), version: z.string() }),
      }),
    ]),
  }),
  z.object({
    method: z.literal("model/list"),
    params: z.object({}),
  }),
  z.object({
    method: z.literal("thread/start"),
    params: z.union([
      canonicalThreadStartParamsSchema,
      claudeThreadStartParamsSchema,
    ]),
  }),
  z.object({
    method: z.literal("thread/resume"),
    params: z.union([
      canonicalThreadResumeParamsSchema,
      claudeThreadResumeParamsSchema,
    ]),
  }),
  z.object({
    method: z.literal("thread/fork"),
    params: z.union([
      canonicalThreadForkParamsSchema,
      claudeThreadForkParamsSchema,
    ]),
  }),
  z.object({
    method: z.literal("turn/start"),
    params: z.union([
      canonicalTurnStartParamsSchema,
      claudeTurnStartParamsSchema,
    ]),
  }),
  z.object({
    method: z.literal("turn/steer"),
    params: z.union([
      canonicalTurnSteerParamsSchema,
      claudeTurnSteerParamsSchema,
    ]),
  }),
  z.object({
    method: z.literal("thread/stop"),
    params: z.union([
      canonicalThreadStopParamsSchema,
      claudeThreadStopParamsSchema,
    ]),
  }),
  z.object({
    method: z.literal("thread/discard"),
    params: canonicalThreadDiscardParamsSchema,
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

export type ThreadStopParams = z.infer<typeof claudeThreadStopParamsSchema>;

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

/**
 * Whether the params carry a canonical-dialect marker (the same fields the
 * request handlers narrow on). Decides which union branch's issues a decode
 * failure reports.
 */
function isCanonicalDialectParams(params: Record<string, unknown>): boolean {
  return (
    "options" in params || "intent" in params || "protocolVersion" in params
  );
}

type BridgeCommandIssue = z.core.$ZodIssue;

/**
 * Every dual-dialect params schema unions the canonical Provider Bridge
 * Protocol shape (first) with the legacy shape (last). A failed union parse
 * reports only the branch the request's dialect markers select, so a
 * malformed request names the missing fields of the shape its caller meant
 * instead of an opaque "Invalid input" union error (#853: replies must be
 * debuggable).
 */
function selectDialectBranchIssues(
  issue: BridgeCommandIssue,
  canonicalDialect: boolean,
): BridgeCommandIssue[] {
  if (issue.code !== "invalid_union" || issue.errors.length === 0) {
    return [issue];
  }
  const branch = canonicalDialect
    ? issue.errors[0]
    : issue.errors[issue.errors.length - 1];
  return (branch ?? []).flatMap((inner) =>
    selectDialectBranchIssues(inner, canonicalDialect).map((selected) => ({
      ...selected,
      path: [...issue.path, ...selected.path],
    })),
  );
}

function formatZodIssues(error: z.ZodError, canonicalDialect: boolean): string {
  return error.issues
    .flatMap((issue) => selectDialectBranchIssues(issue, canonicalDialect))
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
      issues: formatZodIssues(
        command.error,
        isCanonicalDialectParams(envelope.data.params ?? {}),
      ),
    };
  }

  return {
    kind: "request",
    request: { ...command.data, jsonrpc: "2.0", id },
  };
}
