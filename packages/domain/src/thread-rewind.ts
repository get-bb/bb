import { z } from "zod";
import { promptInputSchema } from "./shared-types.js";

/**
 * The first rewind release branches provider conversation state only. A
 * workspace checkout is deliberately not part of this contract: provider
 * history and filesystem history have different consistency guarantees.
 */
export const threadRewindModeValues = ["conversation-only"] as const;
export const threadRewindModeSchema = z.enum(threadRewindModeValues);
export type ThreadRewindMode = z.infer<typeof threadRewindModeSchema>;

/** Providers with a verified point-in-history branch primitive. */
export const threadRewindProviderValues = ["codex", "claude-code"] as const;
export const threadRewindProviderSchema = z.enum(threadRewindProviderValues);
export type ThreadRewindProvider = z.infer<typeof threadRewindProviderSchema>;

export const threadRewindAnchorKindValues = [
  "codex-turn-id",
  "claude-message-id",
] as const;
export const threadRewindAnchorKindSchema = z.enum(
  threadRewindAnchorKindValues,
);
export type ThreadRewindAnchorKind = z.infer<
  typeof threadRewindAnchorKindSchema
>;

/**
 * A provider anchor is intentionally a discriminated union. Keeping the two
 * identifiers in separate fields prevents a Codex turn id from being passed
 * to Claude (or vice versa) when a provider session is replaced.
 */
export const threadRewindProviderAnchorSchema = z.discriminatedUnion(
  "provider",
  [
    z
      .object({
        provider: z.literal("codex"),
        turnId: z.string().min(1),
      })
      .strict(),
    z
      .object({
        messageId: z.string().min(1),
        provider: z.literal("claude-code"),
      })
      .strict(),
  ],
);
export type ThreadRewindProviderAnchor = z.infer<
  typeof threadRewindProviderAnchorSchema
>;

/**
 * Stable reasons used by preview, commit, and UI recovery. Values are
 * intentionally product-level; provider-specific diagnostics remain internal
 * details on the host side.
 */
export const threadRewindIneligibilityReasonValues = [
  "thread-not-idle",
  "pending-interaction",
  "queued-input",
  "first-message",
  "not-human-root-turn",
  "turn-incomplete",
  "grouped-input",
  "steer",
  "attachments-not-supported",
  "mentions-not-supported",
  "compaction-boundary",
  "missing-provider-checkpoint",
  "ambiguous-provider-checkpoint",
  "unsupported-provider",
  "archived-thread",
  "fork-thread",
  "side-chat",
  "workspace-restore-not-supported",
  "stale-preview",
] as const;
export const threadRewindIneligibilityReasonSchema = z.enum(
  threadRewindIneligibilityReasonValues,
);
export type ThreadRewindIneligibilityReason = z.infer<
  typeof threadRewindIneligibilityReasonSchema
>;

/** Stable failures for the operation itself, including state races. */
export const threadRewindFailureReasonValues = [
  "thread-not-found",
  "thread-not-idle",
  "pending-interaction",
  "queued-input",
  "rewind-in-progress",
  "target-ineligible",
  "provider-branch-failed",
  "provider-session-unavailable",
  "branch-commit-failed",
  "workspace-restore-not-supported",
  "stale-preview",
] as const;
export const threadRewindFailureReasonSchema = z.enum(
  threadRewindFailureReasonValues,
);
export type ThreadRewindFailureReason = z.infer<
  typeof threadRewindFailureReasonSchema
>;

export const threadRewindProviderCapabilitySchema = z.object({
  exactAnchor: z.enum([...threadRewindAnchorKindValues, "none"] as const),
  provider: z.string().min(1),
  supportsConversationBranch: z.boolean(),
  supportsWorkspaceRestore: z.literal(false),
});
export type ThreadRewindProviderCapability = z.infer<
  typeof threadRewindProviderCapabilitySchema
>;

/** The checked-in provider matrix used by policy and future UI capability work. */
export const threadRewindProviderCapabilityMatrix = {
  "claude-code": {
    exactAnchor: "claude-message-id",
    provider: "claude-code",
    supportsConversationBranch: true,
    supportsWorkspaceRestore: false,
  },
  codex: {
    exactAnchor: "codex-turn-id",
    provider: "codex",
    supportsConversationBranch: true,
    supportsWorkspaceRestore: false,
  },
  unsupported: {
    exactAnchor: "none",
    provider: "unsupported",
    supportsConversationBranch: false,
    supportsWorkspaceRestore: false,
  },
} as const satisfies Record<string, ThreadRewindProviderCapability>;

/**
 * A rewind target is a completed root user turn. `sourceSequence` points at
 * the persisted client/turn/requested row, not an inferred timeline position.
 */
export const threadRewindTargetSchema = z.object({
  branchId: z.string().min(1),
  sourceSequence: z.number().int().nonnegative(),
  turnId: z.string().min(1),
});
export type ThreadRewindTarget = z.infer<typeof threadRewindTargetSchema>;

/** Public request shape shared by server, SDK, and CLI surfaces. */
export const threadRewindRequestSchema = z.object({
  editedInput: z.array(promptInputSchema).min(1),
  mode: threadRewindModeSchema.default("conversation-only"),
  /**
   * The client echoes the preview target so a commit cannot silently apply to
   * a different active branch after another operation reuses the same event
   * sequence. The server must compare this target with the current lineage
   * before creating a provider branch.
   */
  target: threadRewindTargetSchema,
});
export type ThreadRewindRequest = z.infer<typeof threadRewindRequestSchema>;

export const threadRewindEligibilitySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("eligible"),
  }),
  z.object({
    reason: threadRewindIneligibilityReasonSchema,
    status: z.literal("ineligible"),
  }),
]);
export type ThreadRewindEligibility = z.infer<
  typeof threadRewindEligibilitySchema
>;

/** Preview never returns opaque provider anchor values to a client. */
export const threadRewindPreviewSchema = z.object({
  displacedTurnCount: z.number().int().nonnegative(),
  eligibility: threadRewindEligibilitySchema,
  mode: threadRewindModeSchema,
  provider: threadRewindProviderSchema,
  sourceSequence: z.number().int().nonnegative(),
  target: threadRewindTargetSchema,
});
export type ThreadRewindPreview = z.infer<typeof threadRewindPreviewSchema>;

export const threadRewindResultSchema = z.object({
  displacedTurnCount: z.number().int().nonnegative(),
  mode: threadRewindModeSchema,
  previousBranchId: z.string().min(1),
  sourceSequence: z.number().int().nonnegative(),
  threadId: z.string().min(1),
});
export type ThreadRewindResult = z.infer<typeof threadRewindResultSchema>;

export const threadRewindErrorSchema = z.object({
  code: threadRewindFailureReasonSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
});
export type ThreadRewindError = z.infer<typeof threadRewindErrorSchema>;

/**
 * Cases that the first release must keep explicit in tests and product docs.
 * This is data, rather than prose, so server and UI can display the same
 * policy without each growing a subtly different interpretation.
 */
export const threadRewindContractTestMatrix = [
  { case: "first-message", expected: "ineligible" },
  { case: "completed-human-root-turn", expected: "eligible" },
  { case: "grouped-input", expected: "ineligible" },
  { case: "steer", expected: "ineligible" },
  { case: "attachment-input", expected: "ineligible" },
  { case: "mention-input", expected: "ineligible" },
  { case: "compaction-boundary", expected: "ineligible" },
  { case: "archived-thread", expected: "ineligible" },
  { case: "fork-thread", expected: "ineligible" },
  { case: "side-chat", expected: "ineligible" },
  { case: "unsupported-provider", expected: "ineligible" },
  { case: "workspace-restore-request", expected: "ineligible" },
] as const;
