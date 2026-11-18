import { z } from "zod";
import type { AcpAgentCapabilities } from "./client/capabilities.js";

const grokReasoningEffortSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  default: z.boolean().optional(),
});

const grokModelMetaSchema = z.object({
  totalContextTokens: z.number().int().positive().optional(),
  supportsReasoningEffort: z.boolean().optional(),
  reasoningEffort: z.string().optional(),
  reasoningEfforts: z.array(grokReasoningEffortSchema).default([]),
});

const grokModelSchema = z
  .object({
    modelId: z.string().min(1),
    _meta: grokModelMetaSchema.optional(),
  })

  .transform((model) => ({
    modelId: model.modelId,
    ...(model._meta?.totalContextTokens !== undefined
      ? { totalContextTokens: model._meta.totalContextTokens }
      : {}),
    ...(model._meta?.supportsReasoningEffort !== undefined
      ? { supportsReasoningEffort: model._meta.supportsReasoningEffort }
      : {}),
    ...(model._meta?.reasoningEffort !== undefined
      ? { reasoningEffort: model._meta.reasoningEffort }
      : {}),
    reasoningEfforts: model._meta?.reasoningEfforts ?? [],
  }));

const grokCommandSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  inputHint: z.string().optional(),
});

const grokModelStateSchema = z.object({
  availableModels: z.array(grokModelSchema).default([]),
});

const grokHooksSchema = z.object({
  blockingEvents: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  stopSignals: z.array(z.string()).default([]),
});

const grokToolOverridesSchema = z
  .object({
    x_keyword_search: z.boolean().default(false),
    x_semantic_search: z.boolean().default(false),
    x_user_search: z.boolean().default(false),
    x_thread_fetch: z.boolean().default(false),
  })
  .catchall(z.boolean());

const grokExtensionCapabilitiesSchema = z.object({
  toolOverrides: grokToolOverridesSchema.default({
    x_keyword_search: false,
    x_semantic_search: false,
    x_user_search: false,
    x_thread_fetch: false,
  }),
});

export interface GrokReasoningEffort {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly default?: boolean;
}

export interface GrokModelCapability {
  readonly modelId: string;
  readonly totalContextTokens?: number;
  readonly supportsReasoningEffort?: boolean;
  readonly reasoningEffort?: string;
  readonly reasoningEfforts: readonly GrokReasoningEffort[];
}

export interface GrokCommandCapability {
  readonly name: string;
  readonly description?: string;
  readonly inputHint?: string;
}

export interface GrokHooksCapability {
  readonly blockingEvents: readonly string[];
  readonly decisions: readonly string[];
  readonly stopSignals: readonly string[];
}

export interface GrokToolOverrides {
  readonly x_keyword_search: boolean;
  readonly x_semantic_search: boolean;
  readonly x_user_search: boolean;
  readonly x_thread_fetch: boolean;
  readonly [key: string]: boolean;
}

export interface GrokCapabilitySnapshot {
  readonly models: readonly GrokModelCapability[];
  readonly commands: readonly GrokCommandCapability[];
  readonly cancelRewind: boolean;
  readonly sessionRecap: boolean;
  readonly voiceMode: boolean;
  readonly feedbackTraceOffer: boolean;
  readonly fsNotify: boolean;
  readonly hooks: GrokHooksCapability;
  readonly toolOverrides: GrokToolOverrides;
}

export type GrokBooleanCapability =
  | "cancelRewind"
  | "sessionRecap"
  | "voiceMode"
  | "feedbackTraceOffer"
  | "fsNotify";

export class GrokUnsupportedCapabilityError extends Error {
  readonly capability: GrokBooleanCapability;

  constructor(capability: GrokBooleanCapability) {
    super(
      `Grok Build capability "${capability}" is not supported by this agent session.`,
    );
    this.name = "GrokUnsupportedCapabilityError";
    this.capability = capability;
  }
}

function optionalBoolean(
  source: Record<string, unknown>,
  key: string,
): boolean {
  return z.boolean().optional().default(false).parse(source[key]);
}

export function decodeGrokCapabilitySnapshot(
  capabilities: AcpAgentCapabilities,
): GrokCapabilitySnapshot {
  const initializeMeta = capabilities.initializeMeta;
  const modelState = grokModelStateSchema.parse(
    initializeMeta["modelState"] ?? {},
  );
  const commands = z
    .array(grokCommandSchema)
    .parse(initializeMeta["availableCommands"] ?? []);
  const hooks = grokHooksSchema.parse(capabilities.meta["x.ai/hooks"] ?? {});
  const extensionCapabilities = grokExtensionCapabilitiesSchema.parse(
    capabilities.meta["x.ai/capabilities"] ?? {},
  );

  return {
    models: modelState.availableModels,
    commands,
    cancelRewind: optionalBoolean(initializeMeta, "cancelRewind"),
    sessionRecap: optionalBoolean(initializeMeta, "sessionRecap"),
    voiceMode: optionalBoolean(initializeMeta, "voiceMode"),
    feedbackTraceOffer: optionalBoolean(initializeMeta, "feedbackTraceOffer"),
    fsNotify: z
      .boolean()
      .optional()
      .default(false)
      .parse(capabilities.meta["x.ai/fs_notify"]),
    hooks,
    toolOverrides: extensionCapabilities.toolOverrides,
  };
}

export function requireGrokCapability(
  snapshot: GrokCapabilitySnapshot,
  capability: GrokBooleanCapability,
): GrokUnsupportedCapabilityError | undefined {
  return snapshot[capability]
    ? undefined
    : new GrokUnsupportedCapabilityError(capability);
}
