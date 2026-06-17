import { z } from "zod";
import {
  permissionModeSchema,
  promptMentionCommandTriggerSchema,
  reasoningLevelSchema,
} from "./shared-types.js";

export const modelReasoningEffortSchema = z.object({
  reasoningEffort: reasoningLevelSchema,
  description: z.string(),
});
export type ModelReasoningEffort = z.infer<typeof modelReasoningEffortSchema>;

export const availableModelSchema = z.object({
  id: z.string(),
  model: z.string(),
  displayName: z.string(),
  description: z.string(),
  supportedReasoningEfforts: z.array(modelReasoningEffortSchema),
  defaultReasoningEffort: reasoningLevelSchema,
  isDefault: z.boolean(),
});
export type AvailableModel = z.infer<typeof availableModelSchema>;

export const providerCapabilitiesSchema = z.object({
  supportsArchive: z.boolean(),
  supportsRename: z.boolean(),
  supportsServiceTier: z.boolean(),
  supportsUserQuestion: z.boolean(),
  supportsFork: z.boolean(),
  supportedPermissionModes: z.array(permissionModeSchema).min(1),
});
export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>;

export const providerComposerCommandSchema = z.object({
  trigger: promptMentionCommandTriggerSchema,
  name: z.string().min(1).regex(/^[^\s/$]+$/u),
  trailingText: z.string().regex(/^\s*$/u),
});
export type ProviderComposerCommand = z.infer<
  typeof providerComposerCommandSchema
>;

export const providerComposerActionSchema = z.discriminatedUnion("kind", [
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

export const providerInfoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  capabilities: providerCapabilitiesSchema,
  composerActions: z.array(providerComposerActionSchema),
  available: z.boolean(),
});
export type ProviderInfo = z.infer<typeof providerInfoSchema>;

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

export const dynamicToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.unknown(),
});
export type DynamicTool = z.infer<typeof dynamicToolSchema>;
