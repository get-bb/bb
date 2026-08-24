import { z } from "zod";
import { jsonValueSchema } from "./json-value.js";
import {
  PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES,
  PLUGIN_INTERACTION_MAX_TITLE_LENGTH,
  jsonByteLength,
} from "./plugin-interaction-limits.js";
import { threadEventItemPresentationSchema } from "./item-presentation.js";
import {
  extensionKindSchema,
  isExtensionKind,
} from "./provider-extension-kind.js";

export {
  PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES,
  PLUGIN_INTERACTION_MAX_TITLE_LENGTH,
};

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

// ---------------------------------------------------------------------------
// The interaction split (docs/provider-plugin-api.md §4).
//
// Approvals are the closed, policy-bearing set above: permission modes decide
// them without the user. Requests are the open set below: they always reach
// the user (or the plugin that owns them) and a permission mode never answers
// one. Any bridge may raise any kind: the wire payload
// (`pendingInteractionPayloadSchema`) is the approval, the user question, and
// the plugin-defined request. A plan review rides the `plan` approval
// subject, which the pinned permission matrix keeps until the owner moves it.
// ---------------------------------------------------------------------------

/**
 * A plugin-defined request: `kind` is the namespaced `"<pluginId>/<name>"`
 * and the plugin renders it through the existing `pendingInteraction` slot.
 * Any bridge may raise any kind; the server accepts it only while the plugin
 * named by the prefix is loaded, and the client resolves the renderer by
 * that prefix and the name. The `title` is the client's fallback when no
 * renderer is installed. `data` is capped like a plugin's own request, so a
 * bridge cannot register a row every client must then serve.
 */
export const pluginExtensionInteractionRequestPayloadSchema = z.object({
  kind: extensionKindSchema,
  title: z.string().trim().min(1).max(PLUGIN_INTERACTION_MAX_TITLE_LENGTH),
  data: jsonValueSchema.refine(
    (value) => jsonByteLength(value) <= PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES,
    { message: "Plugin request data exceeds 64 KiB" },
  ),
});
export type PluginExtensionInteractionRequestPayload = z.infer<
  typeof pluginExtensionInteractionRequestPayloadSchema
>;

/**
 * The open request family. A plain union rather than a discriminated one
 * because the plugin member's `kind` is a namespace pattern, not a literal;
 * the core literal (`user_question`) contains no "/" so the members never
 * overlap.
 */
export const interactionRequestPayloadSchema = z.union([
  userQuestionPendingInteractionPayloadSchema,
  pluginExtensionInteractionRequestPayloadSchema,
]);
export type InteractionRequestPayload = z.infer<
  typeof interactionRequestPayloadSchema
>;

/**
 * The payload a provider raises through `interaction/request`: an approval,
 * a user question, or a plugin-defined request. A plain union because the
 * plugin member's kind is a namespace pattern, not a literal.
 */
export const pendingInteractionPayloadSchema = z.union([
  approvalPendingInteractionPayloadSchema,
  userQuestionPendingInteractionPayloadSchema,
  pluginExtensionInteractionRequestPayloadSchema,
]);
export type PendingInteractionPayload = z.infer<
  typeof pendingInteractionPayloadSchema
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

export function isPluginExtensionInteractionRequestPayload(
  payload: AnyPendingInteractionPayload,
): payload is PluginExtensionInteractionRequestPayload {
  return isExtensionKind(payload.kind);
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

/**
 * The answer to a plugin-defined request a provider raised: the value the
 * plugin's `pendingInteraction` form submitted, carried back to the bridge
 * as-is. The route caps it at the same 64 KiB a plugin form may submit.
 */
export const pluginExtensionInteractionResolutionSchema = z.object({
  kind: z.literal("request_answer"),
  value: jsonValueSchema,
});
export type PluginExtensionInteractionResolution = z.infer<
  typeof pluginExtensionInteractionResolutionSchema
>;

export const pendingInteractionResolutionSchema = z.union(
  [
    approvalPendingInteractionResolutionSchema,
    userQuestionPendingInteractionResolutionSchema,
    pluginPendingInteractionResolutionSchema,
    pluginExtensionInteractionResolutionSchema,
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

export function isPluginExtensionInteractionResolution(
  resolution: PendingInteractionResolution,
): resolution is PluginExtensionInteractionResolution {
  return "kind" in resolution && resolution.kind === "request_answer";
}

// ---------------------------------------------------------------------------
// A resolution paired with the payload it answers. A bridge keeps the payload
// it raised and receives the resolution from the wire; parsing the two
// together here is the one place the pairing is checked, so the bridge's
// response encoder narrows on the payload kind and never sees an approval
// subject beside a user answer.
// ---------------------------------------------------------------------------

export const approvalInteractionOutcomeSchema = z.object({
  payload: approvalPendingInteractionPayloadSchema,
  resolution: approvalPendingInteractionResolutionSchema,
});
export type ApprovalInteractionOutcome = z.infer<
  typeof approvalInteractionOutcomeSchema
>;

export const userQuestionInteractionOutcomeSchema = z.object({
  payload: userQuestionPendingInteractionPayloadSchema,
  resolution: userQuestionPendingInteractionResolutionSchema,
});
export type UserQuestionInteractionOutcome = z.infer<
  typeof userQuestionInteractionOutcomeSchema
>;

export const pluginExtensionInteractionOutcomeSchema = z.object({
  payload: pluginExtensionInteractionRequestPayloadSchema,
  resolution: pluginExtensionInteractionResolutionSchema,
});

export const providerInteractionOutcomeSchema = z.union([
  approvalInteractionOutcomeSchema,
  userQuestionInteractionOutcomeSchema,
  pluginExtensionInteractionOutcomeSchema,
]);
export type ProviderInteractionOutcome = z.infer<
  typeof providerInteractionOutcomeSchema
>;

export function isApprovalInteractionOutcome(
  outcome: ProviderInteractionOutcome,
): outcome is ApprovalInteractionOutcome {
  return outcome.payload.kind === "approval";
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
  payload: pendingInteractionPayloadSchema,
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

const providerPendingInteractionBaseSchema =
  pendingInteractionBaseSchema.extend({
    turnId: z.string().min(1),
    providerId: z.string().min(1),
    providerThreadId: z.string().min(1),
    providerRequestId: z.string().min(1),
    origin: pendingInteractionProviderOriginSchema.optional(),
  });

/**
 * A provider interaction pairs its payload with the resolution shape that
 * answers it. The pairing is parsed here, at the boundary (a stored row, an
 * API response), so no consumer downstream can hold an approval next to a
 * user answer: narrowing on the payload kind narrows the resolution with it.
 */
const approvalPendingInteractionSchema =
  providerPendingInteractionBaseSchema.extend({
    payload: approvalPendingInteractionPayloadSchema,
    resolution: approvalPendingInteractionResolutionSchema.nullable(),
  });
export type ApprovalPendingInteraction = z.infer<
  typeof approvalPendingInteractionSchema
>;

const userQuestionPendingInteractionSchema =
  providerPendingInteractionBaseSchema.extend({
    payload: userQuestionPendingInteractionPayloadSchema,
    resolution: userQuestionPendingInteractionResolutionSchema.nullable(),
  });
export type UserQuestionPendingInteraction = z.infer<
  typeof userQuestionPendingInteractionSchema
>;

/** A plugin-defined request a provider raised, answered through the plugin's form. */
const pluginExtensionPendingInteractionSchema =
  providerPendingInteractionBaseSchema.extend({
    payload: pluginExtensionInteractionRequestPayloadSchema,
    resolution: pluginExtensionInteractionResolutionSchema.nullable(),
  });
export type PluginExtensionPendingInteraction = z.infer<
  typeof pluginExtensionPendingInteractionSchema
>;

const providerPendingInteractionSchema = z.union([
  approvalPendingInteractionSchema,
  userQuestionPendingInteractionSchema,
  pluginExtensionPendingInteractionSchema,
]);
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

export function isApprovalPendingInteraction(
  interaction: PendingInteraction,
): interaction is ApprovalPendingInteraction {
  return interaction.payload.kind === "approval";
}

export function isUserQuestionPendingInteraction(
  interaction: PendingInteraction,
): interaction is UserQuestionPendingInteraction {
  return interaction.payload.kind === "user_question";
}

export function isPluginExtensionPendingInteraction(
  interaction: PendingInteraction,
): interaction is PluginExtensionPendingInteraction {
  return isExtensionKind(interaction.payload.kind);
}

// ---------------------------------------------------------------------------
// The interaction lifecycle record — the payload of the one
// `system/interaction/lifecycle` thread event (docs/provider-plugin-api.md §4).
//
// Every status change of every interaction appends one event carrying this
// record: what was asked, who asked, where it stands, and the answer once
// there is one. The record keeps what a reader needs to understand the ask
// and never the live ask's options (an approval's `availableDecisions`) or a
// plugin form's data, which can be 64 KiB per transition. The payload and
// the resolution are paired per member exactly as on the pending
// interaction, so the event cannot carry an approval subject beside a user
// answer.
// ---------------------------------------------------------------------------

const interactionLifecycleRecordBaseSchema = z.object({
  id: z.string().min(1),
  status: pendingInteractionStatusSchema,
  statusReason: z.string().nullable(),
});

/**
 * Who raised the interaction. A provider origin names the request, not the
 * provider thread: the thread is a runtime routing detail the event row
 * does not need, and rows written before this event never recorded it.
 */
const interactionLifecycleProviderOriginSchema = z.object({
  kind: z.literal("provider"),
  providerId: z.string().min(1),
  providerRequestId: z.string().min(1),
});

const approvalInteractionLifecycleRecordPayloadSchema =
  approvalPendingInteractionPayloadSchema.omit({ availableDecisions: true });

const approvalInteractionLifecycleSchema =
  interactionLifecycleRecordBaseSchema.extend({
    origin: interactionLifecycleProviderOriginSchema,
    payload: approvalInteractionLifecycleRecordPayloadSchema,
    resolution: approvalPendingInteractionResolutionSchema.nullable(),
  });
export type ApprovalInteractionLifecycle = z.infer<
  typeof approvalInteractionLifecycleSchema
>;

const userQuestionInteractionLifecycleSchema =
  interactionLifecycleRecordBaseSchema.extend({
    origin: interactionLifecycleProviderOriginSchema,
    payload: userQuestionPendingInteractionPayloadSchema,
    resolution: userQuestionPendingInteractionResolutionSchema.nullable(),
  });
export type UserQuestionInteractionLifecycle = z.infer<
  typeof userQuestionInteractionLifecycleSchema
>;

const pluginInteractionLifecycleSchema =
  interactionLifecycleRecordBaseSchema.extend({
    origin: pendingInteractionPluginOriginSchema,
    payload: pluginPendingInteractionPayloadSchema.omit({ data: true }),
    resolution: pluginPendingInteractionResolutionSchema.nullable(),
  });

/**
 * A plugin-defined request a provider raised. The record keeps the kind and
 * the title, never the form's data, and notes that an answer was given
 * without carrying its value (up to 64 KiB).
 */
const pluginExtensionInteractionLifecycleSchema =
  interactionLifecycleRecordBaseSchema.extend({
    origin: interactionLifecycleProviderOriginSchema,
    payload: pluginExtensionInteractionRequestPayloadSchema.omit({
      data: true,
    }),
    resolution: pluginExtensionInteractionResolutionSchema
      .omit({ value: true })
      .nullable(),
  });

/**
 * A plain union: the members pair a payload kind with its resolution, and
 * the payload kind is the discriminator a reader narrows on through the
 * guards below.
 */
export const interactionLifecycleSchema = z.union([
  approvalInteractionLifecycleSchema,
  userQuestionInteractionLifecycleSchema,
  pluginInteractionLifecycleSchema,
  pluginExtensionInteractionLifecycleSchema,
]);
export type InteractionLifecycle = z.infer<typeof interactionLifecycleSchema>;

export function isApprovalInteractionLifecycle(
  lifecycle: InteractionLifecycle,
): lifecycle is ApprovalInteractionLifecycle {
  return lifecycle.payload.kind === "approval";
}

export function isUserQuestionInteractionLifecycle(
  lifecycle: InteractionLifecycle,
): lifecycle is UserQuestionInteractionLifecycle {
  return lifecycle.payload.kind === "user_question";
}

/** The lifecycle record of a pending interaction as it stands now. */
export function toInteractionLifecycle(
  interaction: PendingInteraction,
): InteractionLifecycle {
  const base = {
    id: interaction.id,
    status: interaction.status,
    statusReason: interaction.statusReason,
  };
  if (isPluginPendingInteraction(interaction)) {
    return {
      ...base,
      origin: interaction.origin,
      payload: { kind: "plugin", title: interaction.payload.title },
      resolution: interaction.resolution,
    };
  }
  const origin = {
    kind: "provider" as const,
    providerId: interaction.providerId,
    providerRequestId: interaction.providerRequestId,
  };
  if (isApprovalPendingInteraction(interaction)) {
    const { availableDecisions: _availableDecisions, ...payload } =
      interaction.payload;
    return {
      ...base,
      origin,
      payload,
      resolution: interaction.resolution,
    };
  }
  if (isUserQuestionPendingInteraction(interaction)) {
    return {
      ...base,
      origin,
      payload: interaction.payload,
      resolution: interaction.resolution,
    };
  }
  return {
    ...base,
    origin,
    payload: {
      kind: interaction.payload.kind,
      title: interaction.payload.title,
    },
    resolution:
      interaction.resolution === null ? null : { kind: "request_answer" },
  };
}
