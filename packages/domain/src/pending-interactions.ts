import { z } from "zod";
import { jsonValueSchema } from "./json-value.js";
import { PLUGIN_INTERACTION_MAX_TITLE_LENGTH } from "./plugin-interaction-limits.js";
import { threadEventItemPresentationSchema } from "./item-presentation.js";
import { extensionKindSchema } from "./provider-extension-kind.js";

export { PLUGIN_INTERACTION_MAX_TITLE_LENGTH };

export const pendingInteractionStatusSchema = z.enum([
  "pending",
  "resolving",
  "resolved",
  "interrupted",
]);
export type PendingInteractionStatus = z.infer<
  typeof pendingInteractionStatusSchema
>;

export const pendingInteractionCommandActionSchema = z.discriminatedUnion(
  "type",
  [
    z.object({
      type: z.literal("read"),
      command: z.string(),
      name: z.string(),
      path: z.string(),
    }),
    z.object({
      type: z.literal("listFiles"),
      command: z.string(),
      path: z.string().nullable(),
    }),
    z.object({
      type: z.literal("search"),
      command: z.string(),
      query: z.string().nullable(),
      path: z.string().nullable(),
    }),
    z.object({
      type: z.literal("unknown"),
      command: z.string(),
    }),
  ],
);
export type PendingInteractionCommandAction = z.infer<
  typeof pendingInteractionCommandActionSchema
>;

export const pendingInteractionNetworkPermissionsSchema = z.object({
  enabled: z.boolean().nullable(),
});

export const pendingInteractionFileSystemPermissionsSchema = z.object({
  read: z.array(z.string()),
  write: z.array(z.string()),
});

const pendingInteractionMacOsPreferencesPermissionSchema = z.enum([
  "none",
  "read_only",
  "read_write",
]);

const pendingInteractionMacOsContactsPermissionSchema = z.enum([
  "none",
  "read_only",
  "read_write",
]);

const pendingInteractionMacOsAutomationPermissionSchema = z.union([
  z.literal("none"),
  z.literal("all"),
  z.object({
    kind: z.literal("bundle_ids"),
    bundleIds: z.array(z.string()),
  }),
]);

export const pendingInteractionMacOsPermissionsSchema = z.object({
  preferences: pendingInteractionMacOsPreferencesPermissionSchema,
  automations: pendingInteractionMacOsAutomationPermissionSchema,
  launchServices: z.boolean(),
  accessibility: z.boolean(),
  calendar: z.boolean(),
  reminders: z.boolean(),
  contacts: pendingInteractionMacOsContactsPermissionSchema,
});
export type PendingInteractionMacOsPermissions = z.infer<
  typeof pendingInteractionMacOsPermissionsSchema
>;

export const pendingInteractionRequestedPermissionProfileSchema = z.object({
  network: pendingInteractionNetworkPermissionsSchema.nullable(),
  fileSystem: pendingInteractionFileSystemPermissionsSchema.nullable(),
  macos: pendingInteractionMacOsPermissionsSchema.nullable(),
});
export type PendingInteractionRequestedPermissionProfile = z.infer<
  typeof pendingInteractionRequestedPermissionProfileSchema
>;

const pendingInteractionGrantablePermissionProfileSchema = z
  .object({
    network: pendingInteractionNetworkPermissionsSchema.nullable(),
    fileSystem: pendingInteractionFileSystemPermissionsSchema.nullable(),
  })
  .strict();
export type PendingInteractionGrantablePermissionProfile = z.infer<
  typeof pendingInteractionGrantablePermissionProfileSchema
>;

const pendingInteractionGrantedPermissionProfileSchema =
  pendingInteractionGrantablePermissionProfileSchema;
export type PendingInteractionGrantedPermissionProfile = z.infer<
  typeof pendingInteractionGrantedPermissionProfileSchema
>;

const pendingInteractionApprovalDecisionSchema = z.enum([
  "allow_once",
  "allow_for_session",
  "deny",
]);
export type PendingInteractionApprovalDecision = z.infer<
  typeof pendingInteractionApprovalDecisionSchema
>;

const pendingInteractionFileChangeWriteScopeSchema = z.string().min(1);

const pendingInteractionCommandApprovalSubjectSchema = z.object({
  kind: z.literal("command"),
  itemId: z.string().min(1),
  command: z.string().min(1),
  cwd: z.string().nullable(),
  actions: z.array(pendingInteractionCommandActionSchema),
  sessionGrant: pendingInteractionGrantablePermissionProfileSchema.nullable(),
});

const pendingInteractionFileChangeApprovalSubjectSchema = z.object({
  kind: z.literal("file_change"),
  itemId: z.string().min(1),
  writeScope: pendingInteractionFileChangeWriteScopeSchema.nullable(),
  sessionGrant: pendingInteractionGrantablePermissionProfileSchema.nullable(),
});

export const pendingInteractionPermissionGrantApprovalSubjectSchema = z.object({
  kind: z.literal("permission_grant"),
  itemId: z.string().min(1),
  toolName: z.string().nullable(),
  permissions: pendingInteractionGrantablePermissionProfileSchema,
});
export type PendingInteractionPermissionGrantApprovalSubject = z.infer<
  typeof pendingInteractionPermissionGrantApprovalSubjectSchema
>;

/**
 * A finished plan waiting for the user's verdict before the agent may act on
 * it. Unlike the other subjects this grants no permission: the decision only
 * says whether the agent leaves plan mode and starts the work.
 */
const pendingInteractionPlanApprovalSubjectSchema = z.object({
  kind: z.literal("plan"),
  itemId: z.string().min(1),
  /** The plan body, as Markdown. */
  plan: z.string().min(1),
  /** Where the provider saved the plan, or null when it kept it in memory. */
  planFilePath: z.string().min(1).nullable(),
});

/**
 * A generic tool call waiting for approval — any tool that is neither a
 * command nor a file change (an MCP tool, a provider-native tool with no core
 * kind). Policy-bearing like the other approval subjects: `auto` approves it,
 * `accept-edits` asks. `presentation` is the bridge's declarative rendering
 * of the call, so the approval banner reads the same on every client with no
 * tool-name table. The ACP bridge raises it for every permission that is
 * neither a command nor a file change; WS5 (interactions) rewires the rest.
 */
export const pendingInteractionToolUseApprovalSubjectSchema = z.object({
  kind: z.literal("tool_use"),
  itemId: z.string().min(1),
  tool: z.string().min(1),
  presentation: threadEventItemPresentationSchema,
});
export type PendingInteractionToolUseApprovalSubject = z.infer<
  typeof pendingInteractionToolUseApprovalSubjectSchema
>;

const pendingInteractionApprovalSubjectSchema = z.discriminatedUnion("kind", [
  pendingInteractionCommandApprovalSubjectSchema,
  pendingInteractionFileChangeApprovalSubjectSchema,
  pendingInteractionPermissionGrantApprovalSubjectSchema,
  pendingInteractionPlanApprovalSubjectSchema,
  pendingInteractionToolUseApprovalSubjectSchema,
]);
export type PendingInteractionApprovalSubject = z.infer<
  typeof pendingInteractionApprovalSubjectSchema
>;

const approvalPendingInteractionPayloadSchema = z.object({
  kind: z.literal("approval"),
  subject: pendingInteractionApprovalSubjectSchema,
  reason: z.string().nullable(),
  availableDecisions: z.array(pendingInteractionApprovalDecisionSchema).min(1),
});
export type ApprovalPendingInteractionPayload = z.infer<
  typeof approvalPendingInteractionPayloadSchema
>;

export const USER_QUESTION_MAX_QUESTIONS = 4;
export const USER_QUESTION_MAX_OPTIONS = 4;
export const USER_QUESTION_MAX_SELECTED = 4;
export const USER_QUESTION_MAX_FREE_TEXT_LENGTH = 4096;

const pendingInteractionUserQuestionIdSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "User question ids cannot be blank",
  });

const pendingInteractionUserQuestionPromptSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "User question prompts cannot be blank",
  });

const pendingInteractionUserQuestionShortLabelSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "User question short labels cannot be blank",
  });

const pendingInteractionUserQuestionOptionValueSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "User question option values cannot be blank",
  });

const pendingInteractionUserQuestionOptionLabelSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "User question option labels cannot be blank",
  });

const pendingInteractionUserQuestionOptionDescriptionSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "User question option descriptions cannot be blank",
  });

const pendingInteractionUserQuestionFreeTextSchema = z
  .string()
  .min(1)
  .max(
    USER_QUESTION_MAX_FREE_TEXT_LENGTH,
    `User question free text cannot exceed ${USER_QUESTION_MAX_FREE_TEXT_LENGTH} characters`,
  )
  .refine((value) => value.trim().length > 0, {
    message: "User question free text cannot be blank",
  });

const pendingInteractionUserQuestionOptionSchema = z.object({
  value: pendingInteractionUserQuestionOptionValueSchema,
  label: pendingInteractionUserQuestionOptionLabelSchema,
  description: pendingInteractionUserQuestionOptionDescriptionSchema.optional(),
});
export type PendingInteractionUserQuestionOption = z.infer<
  typeof pendingInteractionUserQuestionOptionSchema
>;

export const pendingInteractionUserQuestionQuestionSchema = z
  .object({
    id: pendingInteractionUserQuestionIdSchema,
    prompt: pendingInteractionUserQuestionPromptSchema,
    shortLabel: pendingInteractionUserQuestionShortLabelSchema.optional(),
    multiSelect: z.boolean(),
    options: z
      .array(pendingInteractionUserQuestionOptionSchema)
      .max(
        USER_QUESTION_MAX_OPTIONS,
        `User questions cannot include more than ${USER_QUESTION_MAX_OPTIONS} options`,
      )
      .optional(),
    allowFreeText: z.boolean(),
  })
  .superRefine((question, context) => {
    const optionValues = new Set<string>();
    question.options?.forEach((option, index) => {
      if (optionValues.has(option.value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "User question option values must be unique",
          path: ["options", index, "value"],
        });
        return;
      }
      optionValues.add(option.value);
    });
  })
  .refine(
    (question) => question.allowFreeText || (question.options?.length ?? 0) > 0,
    {
      message:
        "User questions must allow free text or provide at least one option",
      path: ["options"],
    },
  );
export type PendingInteractionUserQuestionQuestion = z.infer<
  typeof pendingInteractionUserQuestionQuestionSchema
>;

export const userQuestionPendingInteractionPayloadSchema = z
  .object({
    kind: z.literal("user_question"),
    questions: z
      .array(pendingInteractionUserQuestionQuestionSchema)
      .min(1)
      .max(
        USER_QUESTION_MAX_QUESTIONS,
        `User questions cannot include more than ${USER_QUESTION_MAX_QUESTIONS} questions`,
      ),
  })
  .superRefine((payload, context) => {
    const questionIds = new Set<string>();
    payload.questions.forEach((question, index) => {
      if (questionIds.has(question.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "User question ids must be unique",
          path: ["questions", index, "id"],
        });
        return;
      }
      questionIds.add(question.id);
    });
  });
export type UserQuestionPendingInteractionPayload = z.infer<
  typeof userQuestionPendingInteractionPayloadSchema
>;

const pluginPendingInteractionPayloadSchema = z.object({
  kind: z.literal("plugin"),
  title: z.string().trim().min(1).max(PLUGIN_INTERACTION_MAX_TITLE_LENGTH),
  data: jsonValueSchema,
});
type PluginPendingInteractionPayload = z.infer<
  typeof pluginPendingInteractionPayloadSchema
>;

export const pendingInteractionPayloadSchema = z.discriminatedUnion("kind", [
  approvalPendingInteractionPayloadSchema,
  userQuestionPendingInteractionPayloadSchema,
]);
export type PendingInteractionPayload = z.infer<
  typeof pendingInteractionPayloadSchema
>;

// ---------------------------------------------------------------------------
// The interaction split (docs/provider-plugin-api.md §4).
//
// Approvals are the closed, policy-bearing set above: permission modes decide
// them without the user. Requests are the open set below: they always reach
// the user (or the plugin that owns them) and a permission mode never answers
// one. `pendingInteractionPayloadSchema` stays the wire shape every producer
// emits today; WS5 rewires producers onto this family and the single
// interaction-lifecycle event, then deletes the `plan` approval subject.
// ---------------------------------------------------------------------------

/**
 * A finished plan waiting for the user's verdict, as a request rather than an
 * approval: no permission mode may auto-answer "ready to code?". Same fields
 * as `pendingInteractionPlanApprovalSubjectSchema`, which it replaces in WS5.
 */
export const planReviewInteractionRequestPayloadSchema = z.object({
  kind: z.literal("plan_review"),
  itemId: z.string().min(1),
  /** The plan body, as Markdown. */
  plan: z.string().min(1),
  /** Where the provider saved the plan, or null when it kept it in memory. */
  planFilePath: z.string().min(1).nullable(),
});
export type PlanReviewInteractionRequestPayload = z.infer<
  typeof planReviewInteractionRequestPayloadSchema
>;

/**
 * A plugin-defined request: `kind` is the namespaced `"<pluginId>/<name>"`
 * and the plugin renders it through the existing `pendingInteraction` slot.
 * Any bridge may raise any kind; the server resolves the renderer by the
 * plugin id prefix. The `title` is the client's fallback when no renderer is
 * installed.
 */
export const pluginExtensionInteractionRequestPayloadSchema = z.object({
  kind: extensionKindSchema,
  title: z.string().trim().min(1).max(PLUGIN_INTERACTION_MAX_TITLE_LENGTH),
  data: jsonValueSchema,
});
export type PluginExtensionInteractionRequestPayload = z.infer<
  typeof pluginExtensionInteractionRequestPayloadSchema
>;

/**
 * The open request family. A plain union rather than a discriminated one
 * because the plugin member's `kind` is a namespace pattern, not a literal;
 * the core literals (`user_question`, `plan_review`) contain no "/" so the
 * members never overlap.
 */
export const interactionRequestPayloadSchema = z.union([
  userQuestionPendingInteractionPayloadSchema,
  planReviewInteractionRequestPayloadSchema,
  pluginExtensionInteractionRequestPayloadSchema,
]);
export type InteractionRequestPayload = z.infer<
  typeof interactionRequestPayloadSchema
>;
type AnyPendingInteractionPayload =
  | PendingInteractionPayload
  | PluginPendingInteractionPayload;

export function isApprovalPendingInteractionPayload(
  payload: AnyPendingInteractionPayload,
): payload is ApprovalPendingInteractionPayload {
  return payload.kind === "approval";
}

export function isUserQuestionPendingInteractionPayload(
  payload: AnyPendingInteractionPayload,
): payload is UserQuestionPendingInteractionPayload {
  return payload.kind === "user_question";
}

export function isPluginPendingInteractionPayload(
  payload: AnyPendingInteractionPayload,
): payload is PluginPendingInteractionPayload {
  return payload.kind === "plugin";
}

const approvalDecisionDiscriminatorError =
  "Invalid discriminator value. Expected 'allow_once' | 'allow_for_session' | 'deny'";

export const approvalPendingInteractionResolutionSchema = z.discriminatedUnion(
  "decision",
  [
    z.object({
      decision: z.literal("allow_once"),
      grantedPermissions:
        pendingInteractionGrantedPermissionProfileSchema.nullable(),
    }),
    z.object({
      decision: z.literal("allow_for_session"),
      grantedPermissions:
        pendingInteractionGrantedPermissionProfileSchema.nullable(),
    }),
    z.object({
      decision: z.literal("deny"),
    }),
  ],
  approvalDecisionDiscriminatorError,
);
export type ApprovalPendingInteractionResolution = z.infer<
  typeof approvalPendingInteractionResolutionSchema
>;

export const pendingInteractionUserAnswerSchema = z.object({
  selected: z
    .array(z.string().min(1))
    .max(
      USER_QUESTION_MAX_SELECTED,
      `User question selected choices cannot exceed ${USER_QUESTION_MAX_SELECTED}`,
    ),
  freeText: pendingInteractionUserQuestionFreeTextSchema.optional(),
});
export type PendingInteractionUserAnswer = z.infer<
  typeof pendingInteractionUserAnswerSchema
>;

export const userQuestionPendingInteractionResolutionSchema = z.object({
  kind: z.literal("user_answer"),
  answers: z.record(z.string().min(1), pendingInteractionUserAnswerSchema),
});
export type UserQuestionPendingInteractionResolution = z.infer<
  typeof userQuestionPendingInteractionResolutionSchema
>;

const pluginPendingInteractionResolutionSchema = z.object({
  kind: z.literal("plugin_submitted"),
});
type PluginPendingInteractionResolution = z.infer<
  typeof pluginPendingInteractionResolutionSchema
>;

export const pendingInteractionResolutionSchema = z.union(
  [
    approvalPendingInteractionResolutionSchema,
    userQuestionPendingInteractionResolutionSchema,
    pluginPendingInteractionResolutionSchema,
  ],
  approvalDecisionDiscriminatorError,
);
export type PendingInteractionResolution = z.infer<
  typeof pendingInteractionResolutionSchema
>;

export function isApprovalPendingInteractionResolution(
  resolution: PendingInteractionResolution,
): resolution is ApprovalPendingInteractionResolution {
  return "decision" in resolution;
}

export function isUserQuestionPendingInteractionResolution(
  resolution: PendingInteractionResolution,
): resolution is UserQuestionPendingInteractionResolution {
  return "kind" in resolution && resolution.kind === "user_answer";
}

export function isPluginPendingInteractionResolution(
  resolution: PendingInteractionResolution,
): resolution is PluginPendingInteractionResolution {
  return "kind" in resolution && resolution.kind === "plugin_submitted";
}

const pendingInteractionProviderOriginSchema = z.object({
  kind: z.literal("provider"),
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1),
  providerRequestId: z.string().min(1),
});

const pendingInteractionPluginOriginSchema = z.object({
  kind: z.literal("plugin"),
  pluginId: z.string().min(1),
  rendererId: z.string().min(1),
});

export const pendingInteractionCreateSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1),
  providerRequestId: z.string().min(1),
  payload: z.union([
    approvalPendingInteractionPayloadSchema,
    userQuestionPendingInteractionPayloadSchema,
  ]),
});
export type PendingInteractionCreate = z.infer<
  typeof pendingInteractionCreateSchema
>;

const pendingInteractionBaseSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  status: pendingInteractionStatusSchema,
  statusReason: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative().nullable().optional(),
  resolvedAt: z.number().int().nonnegative().nullable(),
});

const providerPendingInteractionSchema = pendingInteractionBaseSchema.extend({
  turnId: z.string().min(1),
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1),
  providerRequestId: z.string().min(1),
  origin: pendingInteractionProviderOriginSchema.optional(),
  payload: z.union([
    approvalPendingInteractionPayloadSchema,
    userQuestionPendingInteractionPayloadSchema,
  ]),
  resolution: z
    .union([
      approvalPendingInteractionResolutionSchema,
      userQuestionPendingInteractionResolutionSchema,
    ])
    .nullable(),
});
export type ProviderPendingInteraction = z.infer<
  typeof providerPendingInteractionSchema
>;

const pluginPendingInteractionSchema = pendingInteractionBaseSchema.extend({
  turnId: z.string().min(1).nullable(),
  origin: pendingInteractionPluginOriginSchema,
  payload: pluginPendingInteractionPayloadSchema,
  resolution: pluginPendingInteractionResolutionSchema.nullable(),
});
export type PluginPendingInteraction = z.infer<
  typeof pluginPendingInteractionSchema
>;

export const pendingInteractionSchema = z.union([
  providerPendingInteractionSchema,
  pluginPendingInteractionSchema,
]);
export type PendingInteraction =
  | ProviderPendingInteraction
  | PluginPendingInteraction;

export function isPluginPendingInteraction(
  interaction: PendingInteraction,
): interaction is PluginPendingInteraction {
  return interaction.payload.kind === "plugin";
}
