import { z } from "zod";
import {
  permissionModeSchema,
  promptMentionCommandTriggerSchema,
  reasoningLevelSchema,
} from "./shared-types.js";
import { extensionKindSchema } from "./provider-extension-kind.js";
import { threadEventItemPresentationSchema } from "./item-presentation.js";

export const modelReasoningEffortSchema = z.object({
  reasoningEffort: reasoningLevelSchema,
  description: z.string(),
});
export type ModelReasoningEffort = z.infer<typeof modelReasoningEffortSchema>;

export const availableModelSchema = z.object({
  id: z.string(),
  model: z.string(),
  displayName: z.string(),
  /** Provider route used to run this model when it is distinct from the
   * selected agent provider (for example, a model provider nested under Pi). */
  routeProviderId: z.string().min(1).optional(),
  description: z.string(),
  supportedReasoningEfforts: z.array(modelReasoningEffortSchema),
  defaultReasoningEffort: reasoningLevelSchema,
  isDefault: z.boolean(),
});
export type AvailableModel = z.infer<typeof availableModelSchema>;

const providerCapabilitiesSchema = z.object({
  supportsThreadArchive: z.boolean(),
  supportsThreadRename: z.boolean(),
  supportsServiceTier: z.boolean(),
  supportsNativeUserQuestion: z.boolean(),
  supportsFork: z.boolean(),
  /**
   * The provider can recreate a session at an earlier point, which is what
   * edit-past-message rewind needs. Separate from `supportsFork`: ACP clones
   * whole sessions (tip-only) and cannot stop at a checkpoint.
   */
  supportsSessionRewind: z.boolean(),
  permissionModes: z.array(permissionModeSchema).min(1),
});
export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>;

const providerComposerCommandSchema = z.object({
  trigger: promptMentionCommandTriggerSchema,
  name: z
    .string()
    .min(1)
    .regex(/^[^\s/$]+$/u),
  trailingText: z.string().regex(/^\s*$/u),
});
export type ProviderComposerCommand = z.infer<
  typeof providerComposerCommandSchema
>;

const providerComposerActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("skills"),
    trigger: promptMentionCommandTriggerSchema,
  }),
  z.object({
    kind: z.literal("plan"),
    command: providerComposerCommandSchema,
  }),
  z.object({
    kind: z.literal("goal"),
    command: providerComposerCommandSchema,
  }),
]);
export type ProviderComposerAction = z.infer<
  typeof providerComposerActionSchema
>;

/**
 * Provider copy that core surfaces render today from per-provider tables
 * (usage banners, sign-in hints, the mobile provider picker, the agent guide).
 * Declared once by the provider plugin so no core surface keys copy on a
 * provider id.
 */
export const providerStringsSchema = z.object({
  /** How to sign in on the host ("Run `claude` on the machine to sign in."). */
  signInHint: z.string().min(1),
  /** Shown when a session's credentials expired. */
  expiredHint: z.string().min(1),
  /** Where to install the agent. */
  installUrl: z.string().min(1),
  /** Brand prefix stripped from model display names ("Claude "). */
  brandPrefix: z.string().min(1).optional(),
  /** Plan-mode banner copy for providers that declare the `plan` action. */
  planModeCopy: z.string().min(1).optional(),
  /** Per-theme tint for the provider icon. */
  iconTint: z
    .object({ light: z.string().min(1), dark: z.string().min(1) })
    .optional(),
});
export type ProviderStrings = z.infer<typeof providerStringsSchema>;

/**
 * One selectable option a provider declares for a picker — a service tier or
 * a reasoning level. `id` is the wire value the bridge receives; `label` is
 * what the picker shows. Declared lists are the cold-cache fallback ladder;
 * the provider's `model/list` result is precise per model.
 */
export const providerOptionDescriptorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
});
export type ProviderOptionDescriptor = z.infer<
  typeof providerOptionDescriptorSchema
>;

/**
 * Which extension surfaces a provider plugin declared for one namespaced
 * kind: an item kind (`item.open` with `type: "extension"`), a thread-state
 * kind (`extension.state`), or both. The payload schemas themselves stay in
 * plugin server code; clients only learn which kinds exist.
 */
export const providerExtensionKindInfoSchema = z.object({
  item: z.boolean(),
  state: z.boolean(),
});
export type ProviderExtensionKindInfo = z.infer<
  typeof providerExtensionKindInfoSchema
>;

export const providerExtensionKindsSchema = z.record(
  extensionKindSchema,
  providerExtensionKindInfoSchema,
);
export type ProviderExtensionKinds = z.infer<
  typeof providerExtensionKindsSchema
>;

export const providerInfoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  /**
   * Declared grouping key shared by related providers (the ACP agents).
   * Absent when the provider declared none. Grouping only.
   */
  family: z.string().min(1).optional(),
  logoUrl: z.string().min(1).nullable(),
  /** Sessionless maintenance methods declared by the provider plugin. */
  experimental_providerHealth: z.boolean(),
  experimental_providerUsage: z.boolean(),
  experimental_providerInstallation: z.boolean(),
  capabilities: providerCapabilitiesSchema,
  composerActions: z.array(providerComposerActionSchema),
  available: z.boolean(),
  // -------------------------------------------------------------------------
  // Target-state projection (docs/provider-plugin-api.md §1). Optional and
  // unfilled until WS2a projects them from the plugin declaration; absence
  // means "the provider declared none", never a default. The `experimental_*`
  // and `capabilities.supports*` fields above stay until WS2a stabilizes the
  // surface as one unit.
  // -------------------------------------------------------------------------
  strings: providerStringsSchema.optional(),
  serviceTiers: z.array(providerOptionDescriptorSchema).optional(),
  reasoningLevels: z.array(providerOptionDescriptorSchema).optional(),
  extensionKinds: providerExtensionKindsSchema.optional(),
});
export type ProviderInfo = z.infer<typeof providerInfoSchema>;

/**
 * Typed recovery hints a provider bridge raises instead of error text the
 * runtime would otherwise have to pattern-match (`provider/recovery`, see
 * `providerRecoveryNotificationSchema` in @bb/provider-bridge-protocol).
 *
 * - `sessionArchived`: the provider refused because its session is archived;
 *   the runtime unarchives and retries.
 * - `authRequired`: credentials are missing or expired; typed error plus a
 *   health refresh.
 * - `restartRecommended`: the bridge wants a fresh process; the runtime
 *   restarts it and resumes the session.
 * - `staleTurn`: the steer or stop named a turn that is no longer live; the
 *   runtime drops it.
 * - `rateLimited`: the provider throttled the request; the runtime schedules
 *   a retry.
 *
 * No consumer yet: WS4 (runtime cleanup) acts on these.
 */
export const providerRecoveryKindValues = [
  "sessionArchived",
  "authRequired",
  "restartRecommended",
  "staleTurn",
  "rateLimited",
] as const;
export const providerRecoveryKindSchema = z.enum(providerRecoveryKindValues);
export type ProviderRecoveryKind = z.infer<typeof providerRecoveryKindSchema>;

export const toolCallOutputItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("inputText"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("inputImage"),
    imageUrl: z.string(),
  }),
]);

export const toolCallRequestSchema = z.object({
  requestId: z.union([z.string().min(1), z.number()]),
  threadId: z.string().min(1),
  providerThreadId: z.string().min(1),
  turnId: z.string().min(1),
  callId: z.string().min(1),
  tool: z.string().min(1),
  arguments: z.unknown().optional(),
});
export type ToolCallRequest = z.infer<typeof toolCallRequestSchema>;

export const toolCallResponseSchema = z.object({
  contentItems: z.array(toolCallOutputItemSchema),
  success: z.boolean(),
});
export type ToolCallResponse = z.infer<typeof toolCallResponseSchema>;

/**
 * A bb-injected tool handed to a provider bridge at session construction.
 *
 * `presentation` is how a call to this tool reads as a timeline row (grammar
 * v3, docs/provider-plugin-api.md §3): the bridge stamps it on the
 * `item.open`/`item.close` for the call beside `server: "bb"`, so no core
 * table of bb tool names is needed to label the row. The server resolves it
 * once, at its boundary, for every tool it injects — from the owning
 * plugin's declaration, falling back to a generic label and the plugin's
 * glyph. Optional on the wire while the grammar migrates (A1, additive then
 * delete): a definition recorded before the field existed carries none, and
 * a bridge then presents the call generically; the stabilization pass makes
 * it required.
 */
export const dynamicToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.unknown(),
  presentation: threadEventItemPresentationSchema.optional(),
});
export type DynamicTool = z.infer<typeof dynamicToolSchema>;
