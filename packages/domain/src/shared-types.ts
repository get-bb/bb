import { z } from "zod";

/**
 * Order is load-bearing: `reasoningRank` (index) drives model-switch
 * reconciliation. "ultracode" sits between "xhigh" and "max" because its
 * underlying effort IS xhigh (plus standing workflow orchestration) — a model
 * without ultracode support should reconcile down to xhigh, not up to max.
 */
export const reasoningLevelValues = [
  "low",
  "medium",
  "high",
  "xhigh",
  "ultracode",
  "max",
] as const;
export const reasoningLevelSchema = z.enum(reasoningLevelValues);
export type ReasoningLevel = z.infer<typeof reasoningLevelSchema>;

export const serviceTierSchema = z.enum(["fast", "default"]);
export type ServiceTier = z.infer<typeof serviceTierSchema>;

/**
 * Controls how a provider should incorporate server-owned instructions into its
 * system prompt.
 *
 * - `append`: keep the provider's preset system prompt and append instructions.
 * - `replace`: use the provided instructions as the full system prompt.
 */
export const instructionModeValues = ["append", "replace"] as const;
export const instructionModeSchema = z.enum(instructionModeValues);
export type InstructionMode = z.infer<typeof instructionModeSchema>;

export const permissionModeValues = [
  "full",
  "workspace-write",
  "readonly",
] as const;
export const permissionModeSchema = z.enum(permissionModeValues);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const permissionEscalationValues = ["ask", "deny"] as const;
export const permissionEscalationSchema = z.enum(permissionEscalationValues);
export type PermissionEscalation = z.infer<typeof permissionEscalationSchema>;

export const DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT =
  "https://api.anthropic.com";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
const CLAUDE_CODE_MOCK_CLI_TRAFFIC_TEST_HOSTNAME = "api.anthropic.com";

function normalizeUrlHostname(value: string): string {
  return value.toLowerCase().replace(/^\[(.*)\]$/u, "$1");
}

export function isClaudeCodeMockCliTrafficEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const hostname = normalizeUrlHostname(url.hostname);
  if (url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(hostname)) {
    return true;
  }
  return (
    url.protocol === "https:" &&
    hostname === CLAUDE_CODE_MOCK_CLI_TRAFFIC_TEST_HOSTNAME &&
    url.port === "" &&
    url.username === "" &&
    url.password === ""
  );
}

export const claudeCodeMockCliTrafficEndpointSchema = z
  .string()
  .url()
  .refine(
    isClaudeCodeMockCliTrafficEndpoint,
    "Endpoint must be an http:// loopback URL or https://api.anthropic.com",
  );

export const claudeCodeMockCliTrafficConfigSchema = z
  .object({
    enabled: z.boolean(),
    endpoint: claudeCodeMockCliTrafficEndpointSchema,
  })
  .strict();
export type ClaudeCodeMockCliTrafficConfig = z.infer<
  typeof claudeCodeMockCliTrafficConfigSchema
>;

export const DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG: ClaudeCodeMockCliTrafficConfig =
  {
    enabled: false,
    endpoint: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT,
  };

export const promptInputVisibilityValues = ["agent-only"] as const;
export const promptInputVisibilitySchema = z.enum(promptInputVisibilityValues);

const promptInputVisibilityFields = {
  visibility: promptInputVisibilitySchema.optional(),
};

export const promptMentionPathSourceValues = [
  "workspace",
  "thread-storage",
] as const;
export const promptMentionPathSourceSchema = z.enum(
  promptMentionPathSourceValues,
);
export type PromptMentionPathSource = z.infer<
  typeof promptMentionPathSourceSchema
>;

export const promptMentionPathEntryKindValues = ["file", "directory"] as const;
export const promptMentionPathEntryKindSchema = z.enum(
  promptMentionPathEntryKindValues,
);
export type PromptMentionPathEntryKind = z.infer<
  typeof promptMentionPathEntryKindSchema
>;

export const promptMentionResourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("thread"),
    threadId: z.string(),
    projectId: z.string().optional(),
    label: z.string(),
  }),
  z.object({
    kind: z.literal("path"),
    source: promptMentionPathSourceSchema,
    entryKind: promptMentionPathEntryKindSchema,
    path: z.string(),
    label: z.string(),
  }),
]);
export type PromptMentionResource = z.infer<typeof promptMentionResourceSchema>;

export const promptTextMentionSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  resource: promptMentionResourceSchema,
});
export type PromptTextMention = z.infer<typeof promptTextMentionSchema>;

export const promptInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
    mentions: z.array(promptTextMentionSchema).default([]),
    ...promptInputVisibilityFields,
  }),
  z.object({
    type: z.literal("image"),
    url: z.string().url(),
    ...promptInputVisibilityFields,
  }),
  z.object({
    type: z.literal("localImage"),
    /**
     * Absolute paths and URI-like values are passed through to the runtime.
     * Relative paths are server-managed attachment references, not workspace
     * relative files.
     */
    path: z.string(),
    ...promptInputVisibilityFields,
  }),
  z.object({
    type: z.literal("localFile"),
    /**
     * Absolute paths and URI-like values are passed through to the runtime.
     * Relative paths are server-managed attachment references, not workspace
     * relative files.
     */
    path: z.string(),
    name: z.string().optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    mimeType: z.string().optional(),
    ...promptInputVisibilityFields,
  }),
]);
export type PromptInput = z.infer<typeof promptInputSchema>;

export const threadExecutionSourceSchema = z.enum([
  "client/thread/start",
  "client/turn/requested",
  "client/turn/start",
]);
export type ThreadExecutionSource = z.infer<typeof threadExecutionSourceSchema>;

export const callerExecutionInputSourceValues = [
  "explicit",
  "client-preference",
] as const;
export const callerExecutionInputSourceSchema = z.enum(
  callerExecutionInputSourceValues,
);
export type CallerExecutionInputSource = z.infer<
  typeof callerExecutionInputSourceSchema
>;

export const threadExecutionOptionsSchema = z.object({
  model: z.string().optional(),
  serviceTier: serviceTierSchema.optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  permissionMode: permissionModeSchema.optional(),
  source: threadExecutionSourceSchema.optional(),
  seq: z.number().int().optional(),
});
export type ThreadExecutionOptions = z.infer<
  typeof threadExecutionOptionsSchema
>;

export const resolvedThreadExecutionOptionsSchema =
  threadExecutionOptionsSchema.extend({
    model: z.string().min(1),
    serviceTier: serviceTierSchema,
    reasoningLevel: reasoningLevelSchema,
    permissionMode: permissionModeSchema,
    source: threadExecutionSourceSchema,
  });
export type ResolvedThreadExecutionOptions = z.infer<
  typeof resolvedThreadExecutionOptionsSchema
>;

export const runtimePermissionPolicySchema = z.discriminatedUnion(
  "permissionMode",
  [
    z.object({
      permissionMode: z.literal("full"),
      permissionEscalation: z.null(),
    }),
    z.object({
      permissionMode: z.literal("workspace-write"),
      permissionEscalation: permissionEscalationSchema,
    }),
    z.object({
      permissionMode: z.literal("readonly"),
      permissionEscalation: permissionEscalationSchema,
    }),
  ],
);
export type RuntimePermissionPolicy = z.infer<
  typeof runtimePermissionPolicySchema
>;

const runtimeThreadExecutionBaseOptionsSchema = z.object({
  model: z.string().min(1),
  serviceTier: serviceTierSchema,
  reasoningLevel: reasoningLevelSchema,
  // Optional for legacy command compatibility; the server fills the current
  // app setting before dispatching new runtime work.
  claudeCodeMockCliTraffic: claudeCodeMockCliTrafficConfigSchema.optional(),
  /**
   * Server-owned product policy: whether the provider session may use the
   * Workflows feature. Filled explicitly at the server boundary (per-provider
   * policy), never defaulted downstream.
   */
  workflowsEnabled: z.boolean(),
});

export const runtimeThreadExecutionOptionsSchema =
  runtimeThreadExecutionBaseOptionsSchema.and(runtimePermissionPolicySchema);
export type RuntimeThreadExecutionOptions = z.infer<
  typeof runtimeThreadExecutionOptionsSchema
>;

export const projectExecutionDefaultsSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  serviceTier: serviceTierSchema,
  reasoningLevel: reasoningLevelSchema,
  permissionMode: permissionModeSchema,
});
export type ProjectExecutionDefaults = z.infer<
  typeof projectExecutionDefaultsSchema
>;
