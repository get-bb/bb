import { z } from "zod";

/**
 * Order is load-bearing: `reasoningRank` (index) drives model-switch
 * reconciliation. "none" (no extended thinking) sits at the bottom — only
 * providers that expose a thinking-off variant list it (currently Cursor and
 * Pi models whose `thinkingLevelMap` advertises `off`).
 * "ultracode" sits between "xhigh" and "max" because its underlying effort IS
 * xhigh (plus standing workflow orchestration) — a model without ultracode
 * support should reconcile down to xhigh, not up to max.
 * "ultra" is a Codex-native top tier (max effort plus automatic task
 * delegation) exposed only by some models; it ranks above "max".
 */
export const reasoningLevelValues = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "ultracode",
  "max",
  "ultra",
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

/**
 * Order is load-bearing: the index is the privilege rank that
 * {@link clampPermissionModeToCeiling} compares. "accept-edits" grants the
 * least and "full" the most.
 */
export const permissionModeValues = ["accept-edits", "auto", "full"] as const;
export const permissionModeSchema = z.enum(permissionModeValues);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export function permissionModeRank(permissionMode: PermissionMode): number {
  return permissionModeValues.indexOf(permissionMode);
}

/**
 * Lower a mode to the machine's ceiling. A mode already at or below the ceiling
 * passes through untouched — including one the provider does not support, which
 * stays a provider-capability error rather than becoming a silent upgrade.
 * Above the ceiling, the result is the highest mode the provider supports that
 * still fits. Returns null when the provider supports nothing that low: a
 * machine capped below what the provider needs cannot run it at all.
 */
export function clampPermissionModeToCeiling(args: {
  ceiling: PermissionMode;
  permissionMode: PermissionMode;
  permissionModes?: readonly PermissionMode[];
}): PermissionMode | null {
  const ceilingRank = permissionModeRank(args.ceiling);
  if (permissionModeRank(args.permissionMode) <= ceilingRank) {
    return args.permissionMode;
  }
  const supported = args.permissionModes ?? permissionModeValues;
  const allowed = supported
    .filter((mode) => permissionModeRank(mode) <= ceilingRank)
    .sort(
      (left, right) => permissionModeRank(right) - permissionModeRank(left),
    );
  return allowed[0] ?? null;
}

/**
 * Deprecated public input accepted for one compatibility window. Stored
 * history uses {@link recordedPermissionModeSchema} instead so legacy facts
 * remain distinguishable from current presets.
 */
export const permissionModeInputSchema = z
  .union([permissionModeSchema, z.literal("workspace-write")])
  .transform(
    (permissionMode): PermissionMode =>
      permissionMode === "workspace-write" ? "accept-edits" : permissionMode,
  );

export const legacyRecordedPermissionModeValues = [
  "workspace-write",
  "readonly",
] as const;
export const recordedPermissionModeSchema = z.enum([
  ...permissionModeValues,
  ...legacyRecordedPermissionModeValues,
]);
export type RecordedPermissionMode = z.infer<
  typeof recordedPermissionModeSchema
>;

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

export const promptMentionCommandTriggerValues = ["/"] as const;
export const promptMentionCommandTriggerSchema = z.enum(
  promptMentionCommandTriggerValues,
);
export type PromptMentionCommandTrigger = z.infer<
  typeof promptMentionCommandTriggerSchema
>;

export const promptMentionCommandSourceValues = ["skill", "command"] as const;
export const promptMentionCommandSourceSchema = z.enum(
  promptMentionCommandSourceValues,
);
export type PromptMentionCommandSource = z.infer<
  typeof promptMentionCommandSourceSchema
>;

export const promptMentionCommandOriginValues = [
  "builtin",
  "project",
  "user",
] as const;
export const promptMentionCommandOriginSchema = z.enum(
  promptMentionCommandOriginValues,
);
export type PromptMentionCommandOrigin = z.infer<
  typeof promptMentionCommandOriginSchema
>;

const canonicalPromptMentionResourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("thread"),
    threadId: z.string(),
    projectId: z.string().optional(),
    label: z.string(),
  }),
  z.object({
    kind: z.literal("project"),
    projectId: z.string(),
    label: z.string(),
  }),
  z.object({
    kind: z.literal("section"),
    sectionId: z.string(),
    label: z.string(),
  }),
  z.object({
    kind: z.literal("path"),
    source: promptMentionPathSourceSchema,
    entryKind: promptMentionPathEntryKindSchema,
    path: z.string(),
    label: z.string(),
  }),
  z.object({
    kind: z.literal("command"),
    trigger: promptMentionCommandTriggerSchema,
    name: z.string(),
    source: promptMentionCommandSourceSchema,
    origin: promptMentionCommandOriginSchema,
    label: z.string(),
    argumentHint: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("plugin"),
    pluginId: z.string(),
    /**
     * Named shared-UI icon hint supplied by the plugin mention item. Omitted
     * by mentions persisted before icon hints were stored.
     */
    icon: z.string().nullable().optional(),
    /**
     * Opaque item reference minted by the server's mention search
     * (`<providerId>:<provider item id>`); resolved back through the same
     * plugin's mention provider at send time (plugin design §4.9).
     */
    itemId: z.string(),
    label: z.string(),
  }),
]);

function normalizeLegacyPromptMentionResource(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  if (record.kind !== "folder" || typeof record.folderId !== "string") {
    return value;
  }

  const { folderId, ...rest } = record;
  return { ...rest, kind: "section", sectionId: folderId };
}

/**
 * Persisted prompts created before the section rename still contain the old
 * resource discriminator. Normalize those records at the validation boundary;
 * all newly parsed and authored resources use the canonical section contract.
 */
export const promptMentionResourceSchema = z.preprocess(
  normalizeLegacyPromptMentionResource,
  canonicalPromptMentionResourceSchema,
);
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

export interface PromptCommandSelector {
  trigger: PromptMentionCommandTrigger;
  name: string;
}

type TextPromptInput = Extract<PromptInput, { type: "text" }>;

interface PromptCommandRemovalRange {
  start: number;
  end: number;
}

function isSelectedPromptCommandMention(
  mention: PromptTextMention,
  selector: PromptCommandSelector,
): boolean {
  return (
    mention.resource.kind === "command" &&
    mention.resource.trigger === selector.trigger &&
    mention.resource.name === selector.name
  );
}

const BUILTIN_COMPACT_COMMAND = { trigger: "/", name: "compact" } as const;

/**
 * Whether input consists solely of one selected built-in `/compact` mention.
 * Raw matching text and project/user commands intentionally do not qualify.
 */
export function isStandaloneBuiltinCompactCommand(
  input: readonly PromptInput[],
): boolean {
  const selected = input.flatMap((item) =>
    item.type === "text"
      ? item.mentions
          .filter((mention) =>
            isSelectedPromptCommandMention(mention, BUILTIN_COMPACT_COMMAND),
          )
          .map((mention) => ({ mention, text: item.text }))
      : [],
  );
  const standalone = selected[0];
  if (
    selected.length !== 1 ||
    !standalone ||
    input.some((item) => item.type !== "text")
  ) {
    return false;
  }
  const { mention, text } = standalone;
  if (
    mention.resource.kind !== "command" ||
    mention.resource.source !== "command" ||
    mention.resource.origin !== "builtin" ||
    text.slice(mention.start, mention.end) !== "/compact"
  ) {
    return false;
  }
  return removeCommandMentionsFromPromptInput(
    input,
    BUILTIN_COMPACT_COMMAND,
  ).every((item) => item.type === "text" && item.text.trim() === "");
}

/** Structured prompt input for the selected built-in `/compact` command. */
export function createStandaloneBuiltinCompactCommandInput(): PromptInput[] {
  return [
    {
      type: "text",
      text: "/compact",
      mentions: [
        {
          start: 0,
          end: "/compact".length,
          resource: {
            kind: "command",
            trigger: "/",
            name: "compact",
            source: "command",
            origin: "builtin",
            label: "compact",
            argumentHint: null,
          },
        },
      ],
    },
  ];
}

export function promptInputHasCommandMention(
  input: readonly PromptInput[],
  selector: PromptCommandSelector,
): boolean {
  return input.some(
    (item) =>
      item.type === "text" &&
      item.mentions.some((mention) =>
        isSelectedPromptCommandMention(mention, selector),
      ),
  );
}

function commandRemovalRanges(
  input: TextPromptInput,
  selector: PromptCommandSelector,
): PromptCommandRemovalRange[] {
  return input.mentions
    .filter((mention) => isSelectedPromptCommandMention(mention, selector))
    .map((mention) => ({
      start: mention.start,
      end:
        input.text[mention.end] === " " && mention.end < input.text.length
          ? mention.end + 1
          : mention.end,
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

function removedBefore(
  ranges: readonly PromptCommandRemovalRange[],
  position: number,
): number {
  let removed = 0;
  for (const range of ranges) {
    if (range.end <= position) {
      removed += range.end - range.start;
    }
  }
  return removed;
}

function isInsideRemovalRange(
  ranges: readonly PromptCommandRemovalRange[],
  mention: PromptTextMention,
): boolean {
  return ranges.some(
    (range) => mention.start < range.end && mention.end > range.start,
  );
}

function removeCommandMentionsFromTextInput(
  input: TextPromptInput,
  selector: PromptCommandSelector,
): TextPromptInput {
  const ranges = commandRemovalRanges(input, selector);
  if (ranges.length === 0) {
    return input;
  }

  let text = "";
  let cursor = 0;
  for (const range of ranges) {
    text += input.text.slice(cursor, range.start);
    cursor = range.end;
  }
  text += input.text.slice(cursor);

  return {
    ...input,
    text,
    mentions: input.mentions
      .filter(
        (mention) =>
          !isSelectedPromptCommandMention(mention, selector) &&
          !isInsideRemovalRange(ranges, mention),
      )
      .map((mention) => {
        const start = mention.start - removedBefore(ranges, mention.start);
        const end = mention.end - removedBefore(ranges, mention.end);
        return { ...mention, start, end };
      }),
  };
}

export function removeCommandMentionsFromPromptInput(
  input: readonly PromptInput[],
  selector: PromptCommandSelector,
): PromptInput[] {
  return input.map((item) =>
    item.type === "text"
      ? removeCommandMentionsFromTextInput(item, selector)
      : item,
  );
}

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

export const recordedThreadExecutionOptionsSchema =
  resolvedThreadExecutionOptionsSchema.extend({
    permissionMode: recordedPermissionModeSchema,
  });
export type RecordedThreadExecutionOptions = z.infer<
  typeof recordedThreadExecutionOptionsSchema
>;

export const runtimePermissionScopeValues = ["workspace", "full"] as const;
export const runtimePermissionScopeSchema = z.enum(
  runtimePermissionScopeValues,
);
export type RuntimePermissionScope = z.infer<
  typeof runtimePermissionScopeSchema
>;

export const approvalReviewerValues = ["user", "automatic"] as const;
export const approvalReviewerSchema = z.enum(approvalReviewerValues);
export type ApprovalReviewer = z.infer<typeof approvalReviewerSchema>;

export const runtimePermissionPolicySchema = z.discriminatedUnion(
  "permissionMode",
  [
    z.object({
      permissionMode: z.literal("accept-edits"),
      permissionScope: z.literal("workspace"),
      approvalReviewer: z.literal("user"),
      permissionEscalation: permissionEscalationSchema,
    }),
    z.object({
      permissionMode: z.literal("auto"),
      permissionScope: z.literal("workspace"),
      approvalReviewer: z.literal("automatic"),
      permissionEscalation: permissionEscalationSchema,
    }),
    z.object({
      permissionMode: z.literal("full"),
      permissionScope: z.literal("full"),
      approvalReviewer: z.null(),
      permissionEscalation: z.null(),
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
  claudeCodePermissionMode: z.literal("plan").optional(),
  // Optional for legacy command compatibility; the server fills the current
  // app setting before dispatching new runtime work.
  claudeCodeMockCliTraffic: claudeCodeMockCliTrafficConfigSchema.optional(),
  /**
   * Server-owned product policy: whether the provider session may use the
   * Workflows feature. Filled explicitly at the server boundary (per-provider
   * policy), never defaulted downstream.
   */
  workflowsEnabled: z.boolean(),
  // Optional for legacy command compatibility; the server fills the current
  // provider preference before dispatching new runtime work.
  memoryEnabled: z.boolean().optional(),
  // Optional for legacy command compatibility; the server fills the current
  // provider preference before dispatching new runtime work.
  providerSubagentsEnabled: z.boolean().optional(),
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
