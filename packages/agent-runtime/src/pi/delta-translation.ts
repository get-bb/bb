/**
 * Pi dialect parsing → narrow-grammar deltas.
 *
 * Translates pi bridge notifications (the `sdk/message` envelope around raw
 * Pi SDK `AgentSessionEvent`s plus the bridge's own runtime notifications)
 * into `thread/delta` semantic deltas. Everything timeline-shaped — turn/item
 * ids, accepted-input correlation, pairing, settlement, accumulation — is the
 * runtime delta assembler's job; this module only knows the pi dialect:
 * schema narrowing, tool classification (bash → command, edit/write →
 * fileChange), output-placeholder stripping, the ignored-event set,
 * visibility classification for unhandled events, and the model catalog that
 * resolves context windows.
 */

import {
  getBuiltinModels,
  getBuiltinProviders,
} from "@earendil-works/pi-ai/providers/all";
import { z } from "zod";
import type { ProviderRawEvent } from "@bb/domain";
import { providerRawEventSchema, toPositiveNumber } from "@bb/domain";
import type {
  DeltaItemShape,
  DeltaNoTurnFallback,
  ThreadDelta,
} from "@bb/provider-bridge-protocol";
import {
  bashArgsSchema,
  errorEnvelopeSchema,
  extractResultText,
  jsonRpcEnvelopeSchema,
  normalizeProviderCommandOutput,
  sdkMessageEnvelopeSchema,
  textBlockSchema,
  threadContextWindowUsageEnvelopeSchema,
  toNonNegativeNumber,
  toOptionalString,
} from "@bb/provider-bridge-protocol/bridge-kit";
import type { JsonRpcMessage } from "@bb/provider-bridge-protocol/bridge-kit";
import { toCanonicalPiModelId } from "./model-list.js";
import { piVisibilityMetadata } from "./visibility.js";

// ---------------------------------------------------------------------------
// Pi event schemas
// ---------------------------------------------------------------------------

interface PiContextWindowModel {
  contextWindow?: number;
  id: string;
  provider: string;
}

// Keep Pi's SDK-level turn_start/turn_end outside the translated delta union
// until replay proves they represent bb turn boundaries rather than internal
// provider subturns.
const piEventTypeSchema = z
  .object({
    type: z.enum([
      "agent_end",
      "agent_start",
      "compaction_end",
      "compaction_start",
      "message_update",
      "tool_execution_end",
      "tool_execution_start",
      "tool_execution_update",
    ]),
  })
  .passthrough();

const piPromptSettledEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("pi/prompt/settled"),
  params: z.object({
    threadId: z.string().min(1),
    status: z.enum(["completed", "failed"]),
    error: z.string().optional(),
  }),
});

// Pi events we deliberately drop rather than translate. Without this the
// fallback treats them as unknown and emits an `unhandled` delta, which
// renders as "Unhandled Pi event" in the transcript.
//
// `agent_settled` fires after every agent run completes (Pi's
// AgentSession._emitAgentSettled). BB already derives turn completion from
// `agent_end` plus its `willRetry` flag, so the settle signal carries nothing
// extra for us.
const PI_IGNORED_EVENT_TYPES = new Set(["agent_settled"]);

const piIgnoredEventSchema = z
  .object({ type: z.string() })
  .passthrough()
  .refine((event) => PI_IGNORED_EVENT_TYPES.has(event.type));

const piMessageContentBlockSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const piAssistantUsageSchema = z
  .object({
    input: z.number().optional(),
    output: z.number().optional(),
    cacheRead: z.number().optional(),
    cacheWrite: z.number().optional(),
    totalTokens: z.number().optional(),
  })
  .passthrough();

const piAssistantMessageSchema = z
  .object({
    role: z.literal("assistant"),
    content: z.array(piMessageContentBlockSchema),
    stopReason: z.string().optional(),
    errorMessage: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    usage: piAssistantUsageSchema.optional(),
  })
  .passthrough();

const piConversationMessageSchema = z
  .object({
    role: z.string(),
    content: z.array(piMessageContentBlockSchema).optional(),
    stopReason: z.string().optional(),
    errorMessage: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    usage: piAssistantUsageSchema.optional(),
  })
  .passthrough();

const piAgentStartEventSchema = z
  .object({
    type: z.literal("agent_start"),
  })
  .passthrough();

const piAgentEndEventSchema = z
  .object({
    type: z.literal("agent_end"),
    messages: z.array(piConversationMessageSchema),
    providerCheckpointId: z.string().min(1).optional(),
    willRetry: z.boolean().default(false),
  })
  .passthrough();

const piCompactionStartEventSchema = z
  .object({
    type: z.literal("compaction_start"),
    reason: z.enum(["manual", "threshold", "overflow"]),
  })
  .passthrough();

const piCompactionEndEventSchema = z
  .object({
    type: z.literal("compaction_end"),
    reason: z.enum(["manual", "threshold", "overflow"]),
    aborted: z.boolean(),
    errorMessage: z.string().optional(),
  })
  .passthrough();

const piMessageUpdateEventSchema = z
  .object({
    type: z.literal("message_update"),
    assistantMessageEvent: z
      .object({
        type: z.string(),
        content: z.string().optional(),
        contentIndex: z.number().optional(),
        delta: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const piToolExecutionStartEventSchema = z
  .object({
    type: z.literal("tool_execution_start"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
  })
  .passthrough();

const piToolExecutionEndEventSchema = z
  .object({
    type: z.literal("tool_execution_end"),
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.unknown(),
    isError: z.boolean(),
  })
  .passthrough();

const piToolExecutionUpdateEventSchema = z
  .object({
    type: z.literal("tool_execution_update"),
    toolCallId: z.string(),
    toolName: z.string(),
    partialResult: z.unknown(),
  })
  .passthrough();

const piFileEditArgsSchema = z
  .object({
    path: z.string().optional(),
    oldText: z.string().optional(),
    newText: z.string().optional(),
    content: z.string().optional(),
  })
  .passthrough();

type PiAssistantMessage = z.infer<typeof piAssistantMessageSchema>;
type PiAssistantErrorMessage = PiAssistantMessage & {
  errorMessage: string;
  stopReason: "error";
};
type PiConversationMessage = z.infer<typeof piConversationMessageSchema>;
type PiToolExecutionUpdateEvent = z.infer<
  typeof piToolExecutionUpdateEventSchema
>;

const PI_EMPTY_BASH_OUTPUT_PLACEHOLDERS = ["(no output)"] as const;
const PI_COMMAND_TOOL_NAMES = new Set(["bash"]);
const PI_FILE_CHANGE_TOOL_NAMES = new Set(["edit", "write"]);

const ASSISTANT_STREAM_KEY = "assistant";

// ---------------------------------------------------------------------------
// Tool classification (pi dialect → delta item shapes)
// ---------------------------------------------------------------------------

function classifyPiToolUse(toolName: string, args: unknown): DeltaItemShape {
  if (PI_COMMAND_TOOL_NAMES.has(toolName)) {
    const parsed = bashArgsSchema.safeParse(args);
    const command = parsed.success
      ? toOptionalString(parsed.data.command)
      : undefined;
    if (!command) {
      return { type: "tool", tool: toolName, args };
    }
    return {
      type: "command",
      command,
      cwd: toOptionalString(parsed.success ? parsed.data.cwd : undefined) ?? "",
    };
  }

  if (PI_FILE_CHANGE_TOOL_NAMES.has(toolName)) {
    const parsed = piFileEditArgsSchema.safeParse(args);
    if (!parsed.success) {
      return { type: "tool", tool: toolName, args };
    }
    if (!parsed.data.path) {
      return { type: "tool", tool: toolName, args: parsed.data };
    }
    return {
      type: "fileChange",
      path: parsed.data.path,
      ...(parsed.data.oldText === undefined
        ? {}
        : { oldText: parsed.data.oldText }),
      ...((parsed.data.newText ?? parsed.data.content) === undefined
        ? {}
        : { newText: parsed.data.newText ?? parsed.data.content }),
    };
  }

  return { type: "tool", tool: toolName, args };
}

/** Fallback classification for close-without-open (buildToolResultItem's). */
function classifyPiToolResultFallback(toolName: string): DeltaItemShape {
  if (PI_COMMAND_TOOL_NAMES.has(toolName)) {
    return { type: "command", command: "", cwd: "" };
  }
  if (PI_FILE_CHANGE_TOOL_NAMES.has(toolName)) {
    return { type: "fileChange" };
  }
  return { type: "tool", tool: toolName };
}

// ---------------------------------------------------------------------------
// Model context-window resolution
// ---------------------------------------------------------------------------

interface PiModelContextWindowLookup {
  byCanonicalId: ReadonlyMap<string, number>;
  byModelId: ReadonlyMap<string, number>;
}

export type PiModelContextWindowResolver = (
  lastAssistant: PiAssistantMessage | undefined,
) => number | null;

function buildPiModelContextWindowLookup(
  models: readonly PiContextWindowModel[],
): PiModelContextWindowLookup {
  const byCanonicalId = new Map<string, number>();
  const byModelId = new Map<string, number>();
  for (const model of models) {
    const contextWindow = toPositiveNumber(model.contextWindow);
    if (contextWindow === undefined) {
      continue;
    }
    byCanonicalId.set(
      toCanonicalPiModelId(model.provider, model.id),
      contextWindow,
    );
    // Aggregator providers share model ids, so this map is ambiguous. It only
    // serves messages that report no provider.
    byModelId.set(model.id, contextWindow);
  }
  return { byCanonicalId, byModelId };
}

function createPiModelContextWindowResolver(): PiModelContextWindowResolver {
  const models = getBuiltinProviders().flatMap((provider) =>
    getBuiltinModels(provider),
  );
  return createPiModelContextWindowResolverFrom(models);
}

/** @internal Test seam: resolve against an explicit catalog. */
export function createPiModelContextWindowResolverFrom(
  models: readonly PiContextWindowModel[],
): PiModelContextWindowResolver {
  const modelContextWindowLookup = buildPiModelContextWindowLookup(models);
  return (lastAssistant) =>
    resolvePiModelContextWindow(lastAssistant, modelContextWindowLookup);
}

function resolvePiModelContextWindow(
  lastAssistant: PiAssistantMessage | undefined,
  modelContextWindowLookup: PiModelContextWindowLookup,
): number | null {
  const modelId = toOptionalString(lastAssistant?.model);
  if (!modelId) {
    return null;
  }

  // Pi reports the provider and the provider-native model id separately, and an
  // aggregator model id such as "deepseek/deepseek-v4-flash" also names a
  // direct provider's model. A known provider therefore decides the answer on
  // its own. Falling back to the id alone would hand a model another provider's
  // window whenever the catalog lacks the pair, which happens for models the
  // network refresh added and for custom models.
  const providerId = toOptionalString(lastAssistant?.provider);
  if (providerId) {
    return (
      modelContextWindowLookup.byCanonicalId.get(
        toCanonicalPiModelId(providerId, modelId),
      ) ?? null
    );
  }

  return modelContextWindowLookup.byModelId.get(modelId) ?? null;
}

// ---------------------------------------------------------------------------
// Translator factory
// ---------------------------------------------------------------------------

export interface PiDeltaTranslationContext {
  threadId?: string;
  parentToolCallId?: string;
}

export interface CreatePiDeltaTranslatorOptions {
  /** Override context-window resolution. Used by unit tests to avoid real catalogs. */
  resolveModelContextWindow?: PiModelContextWindowResolver;
}

/**
 * Stateless per-process translator: the pi dialect carries every join key the
 * assembler needs, so no per-thread turn or item state lives here.
 */
export function createPiDeltaTranslator(
  options: CreatePiDeltaTranslatorOptions = {},
) {
  const resolveModelContextWindow =
    options.resolveModelContextWindow ?? createPiModelContextWindowResolver();

  function toRawEvent(rawEvent: JsonRpcMessage): ProviderRawEvent {
    const parsed = providerRawEventSchema.safeParse(rawEvent);
    if (parsed.success) {
      return parsed.data;
    }
    return {
      jsonrpc: "2.0",
      ...(rawEvent.id !== undefined ? { id: rawEvent.id } : {}),
      method: rawEvent.method,
      params: {
        serializationError:
          "Provider raw event params were not JSON-serializable.",
      },
    };
  }

  /** Visibility classification: only unknown coverage becomes an `unhandled`. */
  function unhandledDeltas(
    rawEvent: JsonRpcMessage,
    parentToolCallId: string | undefined,
  ): ThreadDelta[] {
    const description = piVisibilityMetadata.describeRawEvent(rawEvent);
    if (description.coverage !== "unknown") {
      return [];
    }
    return [
      {
        kind: "unhandled",
        raw: toRawEvent(rawEvent),
        rawType: description.kind,
        vouchedTurn: true,
        ...(parentToolCallId ? { parentRef: parentToolCallId } : {}),
      },
    ];
  }

  /**
   * The raw payload a turn-requiring delta carries so the assembler can
   * surface it as provider/unhandled when no turn is open — the old
   * translator's `buildUnexpectedPiSdkEvent` no-active-turn guard, preserved
   * across the bridge/assembler split.
   */
  function noTurnFallbackFor(
    rawMessage: unknown,
    context: PiDeltaTranslationContext | undefined,
  ): DeltaNoTurnFallback {
    const rawEvent: JsonRpcMessage = {
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        ...(context?.threadId ? { threadId: context.threadId } : {}),
        message: rawMessage,
      },
    };
    return {
      raw: toRawEvent(rawEvent),
      rawType: piVisibilityMetadata.describeRawEvent(rawEvent).kind,
    };
  }

  /** A known event whose payload failed its schema: always surfaced. */
  function unexpectedSdkEventDeltas(
    rawMessage: unknown,
    context: PiDeltaTranslationContext | undefined,
  ): ThreadDelta[] {
    const fallback = noTurnFallbackFor(rawMessage, context);
    return [
      {
        kind: "unhandled",
        raw: fallback.raw,
        rawType: fallback.rawType,
        vouchedTurn: true,
        ...(context?.parentToolCallId
          ? { parentRef: context.parentToolCallId }
          : {}),
      },
    ];
  }

  function translate(
    event: unknown,
    context?: PiDeltaTranslationContext,
  ): ThreadDelta[] {
    const sdkEnvelope = sdkMessageEnvelopeSchema.safeParse(event);
    if (sdkEnvelope.success) {
      // Checked here rather than in the recursive call because an empty
      // translation is what triggers the unhandled fallback below.
      if (
        piIgnoredEventSchema.safeParse(sdkEnvelope.data.params.message).success
      ) {
        return [];
      }
      const parentToolCallId =
        sdkEnvelope.data.params.parent_tool_use_id ?? context?.parentToolCallId;
      const translated = translate(sdkEnvelope.data.params.message, {
        ...context,
        ...(parentToolCallId ? { parentToolCallId } : {}),
      });
      return translated.length > 0
        ? translated
        : unhandledDeltas(
            {
              jsonrpc: "2.0",
              method: sdkEnvelope.data.method,
              params: sdkEnvelope.data.params,
            },
            parentToolCallId,
          );
    }

    const promptSettledEnvelope =
      piPromptSettledEnvelopeSchema.safeParse(event);
    if (promptSettledEnvelope.success) {
      return [
        {
          kind: "turn.boundary",
          status: promptSettledEnvelope.data.params.status,
          ...(promptSettledEnvelope.data.params.error !== undefined
            ? { error: { message: promptSettledEnvelope.data.params.error } }
            : {}),
          claimIfIdle: true,
        },
      ];
    }

    const contextWindowUsageEnvelope =
      threadContextWindowUsageEnvelopeSchema.safeParse(event);
    if (contextWindowUsageEnvelope.success) {
      const { contextWindowUsage } = contextWindowUsageEnvelope.data.params;
      const used = contextWindowUsage.usedTokens;
      const size = contextWindowUsage.modelContextWindow;
      return [
        {
          kind: "contextWindow",
          used:
            typeof used === "number" && Number.isFinite(used) && used >= 0
              ? used
              : null,
          size:
            typeof size === "number" && Number.isFinite(size) && size > 0
              ? size
              : null,
          estimated: contextWindowUsage.estimated,
          attach: "currentOrLast",
        },
      ];
    }

    const errorEnvelope = errorEnvelopeSchema.safeParse(event);
    if (errorEnvelope.success) {
      return [
        {
          kind: "provider.error",
          message: "Provider error",
          detail: errorEnvelope.data.params?.message ?? "unknown error",
          settlesTurn: true,
        },
      ];
    }

    const envelope = jsonRpcEnvelopeSchema.safeParse(event);
    if (envelope.success) {
      return unhandledDeltas(
        {
          jsonrpc: "2.0",
          method: envelope.data.method,
          ...(envelope.data.params ? { params: envelope.data.params } : {}),
        },
        context?.parentToolCallId,
      );
    }

    const eventType = piEventTypeSchema.safeParse(event);
    if (!eventType.success) {
      return [];
    }
    const parentRef = context?.parentToolCallId;
    const parentRefField = parentRef ? { parentRef } : {};

    switch (eventType.data.type) {
      case "agent_start": {
        const piEvent = piAgentStartEventSchema.safeParse(event);
        if (!piEvent.success) {
          return unexpectedSdkEventDeltas(event, context);
        }
        return [{ kind: "turn.open" }];
      }

      case "compaction_start": {
        const parsed = piCompactionStartEventSchema.safeParse(event);
        if (!parsed.success) {
          return unexpectedSdkEventDeltas(event, context);
        }
        const open: ThreadDelta = {
          kind: "item.open",
          key: { channel: "compaction" },
          item: { type: "compaction" },
          ...(parsed.data.reason === "manual"
            ? {}
            : { attach: "currentOrLast" }),
          noTurnFallback: noTurnFallbackFor(event, context),
        };
        return parsed.data.reason === "manual"
          ? [{ kind: "turn.open" }, open]
          : [open];
      }

      case "compaction_end": {
        const parsed = piCompactionEndEventSchema.safeParse(event);
        if (!parsed.success) {
          return unexpectedSdkEventDeltas(event, context);
        }
        const succeeded = !parsed.data.aborted && !parsed.data.errorMessage;
        const compacted: ThreadDelta = {
          kind: "context.compacted",
          noTurnFallback: noTurnFallbackFor(event, context),
        };
        if (parsed.data.reason === "manual") {
          return [
            ...(succeeded ? [compacted] : []),
            {
              kind: "turn.boundary",
              status: parsed.data.aborted
                ? "interrupted"
                : parsed.data.errorMessage
                  ? "failed"
                  : "completed",
              ...(parsed.data.errorMessage
                ? { error: { message: parsed.data.errorMessage } }
                : {}),
            },
          ];
        }
        if (succeeded) {
          return [compacted];
        }
        return [
          {
            kind: "provider.error",
            message: parsed.data.aborted
              ? "Context compaction interrupted"
              : "Context compaction failed",
            detail:
              parsed.data.errorMessage ??
              "Automatic context compaction was interrupted",
          },
        ];
      }

      case "agent_end": {
        const piEvent = piAgentEndEventSchema.safeParse(event);
        if (!piEvent.success) {
          return unexpectedSdkEventDeltas(event, context);
        }
        const lastAssistant = findLastAssistantMessage(piEvent.data.messages);
        if (piEvent.data.willRetry) {
          if (lastAssistant && isPiAssistantError(lastAssistant)) {
            return [
              {
                kind: "provider.error",
                message: "Provider error",
                detail: lastAssistant.errorMessage,
                willRetry: true,
              },
            ];
          }
          return [];
        }
        if (lastAssistant && isPiAssistantError(lastAssistant)) {
          return [
            {
              kind: "provider.error",
              message: "Provider error",
              detail: lastAssistant.errorMessage,
              settlesTurn: true,
            },
          ];
        }
        const deltas: ThreadDelta[] = [];
        if (lastAssistant) {
          const text = extractAssistantText(lastAssistant);
          if (text) {
            deltas.push({
              kind: "message.close",
              channel: "assistant",
              streamKey: ASSISTANT_STREAM_KEY,
              text,
              ...parentRefField,
            });
          }
        }
        const usage = toAssistantUsageBreakdown(lastAssistant);
        if (usage) {
          deltas.push({
            kind: "usage.turn",
            tokens: usage,
            modelContextWindow: resolveModelContextWindow(lastAssistant),
          });
        }
        deltas.push({
          kind: "turn.boundary",
          status: "completed",
          ...(piEvent.data.providerCheckpointId !== undefined
            ? { providerCheckpointId: piEvent.data.providerCheckpointId }
            : {}),
          claimIfIdle: true,
        });
        return deltas;
      }

      case "message_update": {
        const piEvent = piMessageUpdateEventSchema.safeParse(event);
        if (!piEvent.success) {
          return unexpectedSdkEventDeltas(event, context);
        }
        const assistantEvent = piEvent.data.assistantMessageEvent;
        if (assistantEvent.type === "text_delta") {
          const delta = assistantEvent.delta;
          if (!delta) {
            return [];
          }
          return [
            {
              kind: "message.delta",
              channel: "assistant",
              streamKey: ASSISTANT_STREAM_KEY,
              text: delta,
              ...parentRefField,
            },
          ];
        }
        if (assistantEvent.type === "thinking_delta") {
          const delta = assistantEvent.delta;
          if (!delta) {
            return [];
          }
          if (typeof assistantEvent.contentIndex !== "number") {
            return unexpectedSdkEventDeltas(event, context);
          }
          return [
            {
              kind: "message.delta",
              channel: "reasoning",
              streamKey: String(assistantEvent.contentIndex),
              text: delta,
              ...parentRefField,
            },
          ];
        }
        if (assistantEvent.type === "thinking_end") {
          const content = assistantEvent.content;
          if (!content) {
            return [];
          }
          if (typeof assistantEvent.contentIndex !== "number") {
            return unexpectedSdkEventDeltas(event, context);
          }
          return [
            {
              kind: "message.close",
              channel: "reasoning",
              streamKey: String(assistantEvent.contentIndex),
              text: content,
              ...parentRefField,
            },
          ];
        }
        return [];
      }

      case "tool_execution_start": {
        const piEvent = piToolExecutionStartEventSchema.safeParse(event);
        if (!piEvent.success) {
          return unexpectedSdkEventDeltas(event, context);
        }
        return [
          {
            kind: "item.open",
            key: {
              providerItemId: piEvent.data.toolCallId,
              ...parentRefField,
            },
            item: classifyPiToolUse(piEvent.data.toolName, piEvent.data.args),
            noTurnFallback: noTurnFallbackFor(piEvent.data, context),
          },
        ];
      }

      case "tool_execution_end": {
        const piEvent = piToolExecutionEndEventSchema.safeParse(event);
        if (!piEvent.success) {
          return unexpectedSdkEventDeltas(event, context);
        }
        const resultText = extractResultText(piEvent.data.result);
        const aggregatedOutput = PI_COMMAND_TOOL_NAMES.has(
          piEvent.data.toolName,
        )
          ? extractPiCommandExecutionOutput(piEvent.data.result)
          : undefined;
        return [
          {
            kind: "item.close",
            key: {
              providerItemId: piEvent.data.toolCallId,
              ...parentRefField,
            },
            status: piEvent.data.isError ? "failed" : "completed",
            resultText,
            exitCode: piEvent.data.isError ? 1 : 0,
            ...(aggregatedOutput === undefined ? {} : { aggregatedOutput }),
            item: classifyPiToolResultFallback(piEvent.data.toolName),
            noTurnFallback: noTurnFallbackFor(piEvent.data, context),
          },
        ];
      }

      case "tool_execution_update": {
        const piEvent = piToolExecutionUpdateEventSchema.safeParse(event);
        if (!piEvent.success) {
          return unexpectedSdkEventDeltas(event, context);
        }
        if (PI_COMMAND_TOOL_NAMES.has(piEvent.data.toolName)) {
          const snapshot = extractPiCommandExecutionOutput(
            piEvent.data.partialResult,
          );
          if (snapshot === undefined) {
            return [];
          }
          return [
            {
              kind: "command.outputSnapshot",
              key: {
                providerItemId: piEvent.data.toolCallId,
                ...parentRefField,
              },
              text: snapshot,
              noTurnFallback: noTurnFallbackFor(piEvent.data, context),
            },
          ];
        }
        return [
          {
            kind: "item.progress",
            key: {
              providerItemId: piEvent.data.toolCallId,
              ...parentRefField,
            },
            message: extractPiToolProgressText(piEvent.data),
            noTurnFallback: noTurnFallbackFor(piEvent.data, context),
          },
        ];
      }

      default:
        return [];
    }
  }

  return { translate };
}

export type PiDeltaTranslator = ReturnType<typeof createPiDeltaTranslator>;

// ---------------------------------------------------------------------------
// Pi SDK event extraction helpers
// ---------------------------------------------------------------------------

function findLastAssistantMessage(
  messages: PiConversationMessage[],
): PiAssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const parsedMessage = piAssistantMessageSchema.safeParse(message);
    if (parsedMessage.success) {
      return parsedMessage.data;
    }
  }
  return undefined;
}

function extractAssistantText(message: PiAssistantMessage): string | undefined {
  const content = message.content;
  const chunks: string[] = [];
  for (const block of content) {
    const parsedBlock = textBlockSchema.safeParse(block);
    if (parsedBlock.success) {
      chunks.push(parsedBlock.data.text);
    }
  }
  const text = chunks.join("\n").trim();
  return text.length > 0 ? text : undefined;
}

function isPiAssistantError(
  message: PiAssistantMessage,
): message is PiAssistantErrorMessage {
  return (
    message.stopReason === "error" &&
    typeof message.errorMessage === "string" &&
    message.errorMessage.trim().length > 0
  );
}

function extractPiCommandExecutionOutput(content: unknown): string | undefined {
  return normalizeProviderCommandOutput({
    text: extractResultText(content),
    emptyPlaceholders: PI_EMPTY_BASH_OUTPUT_PLACEHOLDERS,
  });
}

function extractPiToolProgressText(event: PiToolExecutionUpdateEvent): string {
  const text = extractResultText(event.partialResult).trim();
  return text.length > 0 ? text : `${event.toolName} progress update`;
}

function toAssistantUsageBreakdown(lastAssistant: PiAssistantMessage | undefined) {
  const typedUsage = lastAssistant?.usage;
  if (!typedUsage) return undefined;

  const inputTokens = toNonNegativeNumber(typedUsage.input);
  const outputTokens = toNonNegativeNumber(typedUsage.output);
  const cachedInputTokens =
    toNonNegativeNumber(typedUsage.cacheRead) +
    toNonNegativeNumber(typedUsage.cacheWrite);
  const totalTokens = toNonNegativeNumber(typedUsage.totalTokens);

  return {
    totalTokens:
      totalTokens > 0
        ? totalTokens
        : inputTokens + outputTokens + cachedInputTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens: 0,
  };
}
