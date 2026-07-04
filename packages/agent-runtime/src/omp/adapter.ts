import {
  threadScope,
  turnScope,
  type AvailableModel,
  type ThreadEvent,
} from "@bb/domain";
import { z } from "zod";
import { getBuiltInAgentProviderInfo } from "@bb/agent-providers";
import { resolveBridgeProcessArgs } from "../shared/bridge-path.js";
import { buildScopedProviderErrorEvents } from "../shared/provider-error-events.js";
import {
  createUnhandledProviderEvent,
} from "../shared/provider-unhandled-event.js";
import {
  errorEnvelopeSchema,
  jsonRpcEnvelopeSchema,
  sdkMessageEnvelopeSchema,
  threadIdentityEnvelopeSchema,
} from "../shared/json-rpc-envelope.js";
import {
  createProviderTurnStateRegistry,
  finishOpenProviderTurn,
  type EnsureProviderTurnStartedArgs,
  type ProviderTurnState,
  type ProviderTurnStateRegistry,
} from "../shared/turn-state.js";
import { UNSTAMPED_THREAD_ID } from "../shared/unstamped-thread-id.js";
import {
  flattenPromptInputGroups,
  noPreparedProviderCommandDispatch,
  type AdapterCommand,
  type ProviderAdapter,
  type ProviderAcceptedCommandTranslationArgs,
  type ProviderCommandPlan,
  type ProviderRequestCommandPlan,
  type ProviderTranslationContext,
} from "../provider-adapter.js";
import { parseOmpAvailableModels } from "./model-list.js";
import type {
  AgentRuntimeOmpSkillRoot,
  AgentRuntimeSkillRoot,
} from "../types.js";

// ---------------------------------------------------------------------------
// omp RPC event schemas (validated at the bb<->bridge boundary)
//
// The bridge wraps every omp AgentSessionEvent in a JSON-RPC 2.0
// `sdk/message` notification and forwards omp RPC responses verbatim. We
// validate each event shape with zod before translating, mirroring the pi
// adapter (omp shares pi's event model since it is a pi fork).
// ---------------------------------------------------------------------------

const ompEventTypeSchema = z.object({ type: z.string() }).passthrough();

const ompAgentStartEventSchema = z
  .object({ type: z.literal("agent_start") })
  .passthrough();

const ompMessageContentBlockSchema = z
  .object({ type: z.string(), text: z.string().optional() })
  .passthrough();

const ompMessageSchema = z
  .object({
    role: z.string(),
    content: z.array(ompMessageContentBlockSchema).optional(),
  })
  .passthrough();

const ompAgentEndEventSchema = z
  .object({
    type: z.literal("agent_end"),
    messages: z.array(ompMessageSchema).optional(),
  })
  .passthrough();

const ompAssistantMessageEventSchema = z
  .object({
    type: z.string(),
    delta: z.string().optional(),
  })
  .passthrough();

const ompMessageUpdateEventSchema = z
  .object({
    type: z.literal("message_update"),
    assistantMessageEvent: ompAssistantMessageEventSchema,
  })
  .passthrough();

interface OmpTurnState extends ProviderTurnState {
  assistantMessageCounter: number;
}

const createOmpTurnState = (): OmpTurnState => ({
  assistantMessageCounter: 0,
  counter: 0,
  currentTurnId: undefined,
  cumulativeTokens: {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  },
  openAssistantMessageIdsByScope: new Map(),
  openReasoningItemIdsByScope: new Map(),
  toolItemsByCallId: new Map(),
});

function extractLastAssistantText(
  messages: readonly z.infer<typeof ompMessageSchema>[],
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }
    const blocks = message.content ?? [];
    const text = blocks
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text ?? "")
      .join("");
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

export interface CreateOmpProviderAdapterOptions {
  /** Override the directory containing the bundled bridge file. */
  bridgeBundleDir?: string;
  /** Override the omp binary the bridge spawns (defaults to `omp` on PATH). */
  ompBinaryPath?: string;
  /** Test-only: force a turn id prefix. */
  turnIdPrefix?: string;
}


/**
 * Build the bb provider adapter for omp (on-my-pi). omp is a divergent fork of
 * vanilla pi with its own auth store, runtime, and protocol, so bb drives the
 * user-installed `omp` CLI over RPC via a thin framing bridge (see
 * `omp/bridge/bridge.ts`). This adapter speaks bb's JSON-RPC 2.0 transport and
 * translates omp `AgentSessionEvent`s into bb `ThreadEvent`s.
 */
export function createOmpProviderAdapter(
  opts?: CreateOmpProviderAdapterOptions,
): ProviderAdapter {
  const providerInfo = getBuiltInAgentProviderInfo("omp");
  const capabilities = providerInfo.capabilities;
  const ompBinaryPath = opts?.ompBinaryPath;

  const turnState: ProviderTurnStateRegistry<OmpTurnState> =
    createProviderTurnStateRegistry<OmpTurnState>({
      createState: createOmpTurnState,
      ...(opts?.turnIdPrefix ? { turnIdPrefix: opts.turnIdPrefix } : {}),
    });

  function ensureOmpTurnStarted(
    args: EnsureProviderTurnStartedArgs<OmpTurnState>,
  ): string {
    return turnState.ensureTurnStarted({
      events: args.events,
      state: args.state,
      threadId: args.threadId,
    });
  }

  function translateOmpSdkMessage(
    message: unknown,
    context: ProviderTranslationContext | undefined,
  ): ThreadEvent[] {
    const threadId = context?.threadId ?? UNSTAMPED_THREAD_ID;
    const state = turnState.getOrCreate({ threadId });
    const events: ThreadEvent[] = [];
    // omp emits many lifecycle/UI events (turn_start/end, message_start/end,
    // thinking deltas, subagent frames, ...) that have no bb equivalent in this
    // iteration. Drop unrecognized events silently rather than surfacing them as
    // timeline noise.
    const eventType = ompEventTypeSchema.safeParse(message);
    if (!eventType.success) {
      return [];
    }

    switch (eventType.data.type) {
      case "agent_start": {
        if (ompAgentStartEventSchema.safeParse(message).success) {
          ensureOmpTurnStarted({ events, state, threadId });
        }
        break;
      }

      case "agent_end": {
        // Always close the turn on agent_end, even if the messages payload
        // varies — otherwise the thread stays "working" forever.
        const parsed = ompAgentEndEventSchema.safeParse(message);
        const currentTurnId = state.currentTurnId;
        if (!currentTurnId) {
          break;
        }
        const text = parsed.success
          ? extractLastAssistantText(parsed.data.messages ?? [])
          : undefined;
        if (text) {
          const itemId = turnState.resolveCompletedAssistantMessageId({
            assistantIdPrefix: "omp-assistant",
            parentToolCallId: context?.parentToolCallId,
            state,
          });
          events.push({
            type: "item/completed",
            threadId,
            providerThreadId: "",
            scope: turnScope(currentTurnId),
            item: { type: "agentMessage", id: itemId, text },
          });
        }
        events.push({
          type: "turn/completed",
          threadId,
          providerThreadId: "",
          scope: turnScope(currentTurnId),
          status: "completed",
        });
        turnState.finishTurn({ state, threadId });
        break;
      }

      case "message_update": {
        const parsed = ompMessageUpdateEventSchema.safeParse(message);
        if (
          parsed.success &&
          parsed.data.assistantMessageEvent.type === "text_delta" &&
          state.currentTurnId &&
          parsed.data.assistantMessageEvent.delta
        ) {
          const itemId = turnState.getOrCreateAssistantMessageId({
            assistantIdPrefix: "omp-assistant",
            parentToolCallId: context?.parentToolCallId,
            state,
          });
          events.push({
            type: "item/agentMessage/delta",
            threadId,
            providerThreadId: "",
            scope: turnScope(state.currentTurnId),
            itemId,
            delta: parsed.data.assistantMessageEvent.delta,
          });
        }
        break;
      }

      default:
        break;
    }

    return events;
  }

  function translateOmpEvent(
    event: unknown,
    context?: ProviderTranslationContext,
  ): ThreadEvent[] {
    const sdkEnvelope = sdkMessageEnvelopeSchema.safeParse(event);
    if (sdkEnvelope.success) {
      const parentToolCallId =
        sdkEnvelope.data.params.parent_tool_use_id ??
        context?.parentToolCallId;
      const translated = translateOmpSdkMessage(sdkEnvelope.data.params.message, {
        ...context,
        ...(parentToolCallId ? { parentToolCallId } : {}),
      });
      if (translated.length > 0) {
        return translated;
      }
      // omp lifecycle/UI events with no bb mapping are dropped silently (no
      // timeline noise). Only structured envelopes below can surface as
      // unhandled.
      return [];
    }

    const identityEnvelope = threadIdentityEnvelopeSchema.safeParse(event);
    if (identityEnvelope.success) {
      const { threadId = UNSTAMPED_THREAD_ID, providerThreadId } =
        identityEnvelope.data.params;
      return providerThreadId
        ? [
            {
              type: "thread/identity",
              threadId,
              providerThreadId,
              scope: threadScope(),
            },
          ]
        : [];
    }

    const errorEnvelope = errorEnvelopeSchema.safeParse(event);
    if (errorEnvelope.success) {
      const detail =
        errorEnvelope.data.params?.message ?? "omp bridge error";
      return buildScopedProviderErrorEvents({
        contextThreadId: context?.threadId,
        detail,
        ensureTurnStarted: ensureOmpTurnStarted,
        registry: turnState,
      });
    }

    const envelope = jsonRpcEnvelopeSchema.safeParse(event);
    if (envelope.success) {
      const fallbackTurnId = context?.threadId
        ? turnState.get({ threadId: context.threadId })?.currentTurnId
        : undefined;
      return [
        createUnhandledProviderEvent({
          providerId: "omp",
          rawType: envelope.data.method,
          rawEvent: {
            jsonrpc: "2.0",
            method: envelope.data.method,
            ...(envelope.data.params ? { params: envelope.data.params } : {}),
          },
          ...(fallbackTurnId ? { turnId: fallbackTurnId } : {}),
        }),
      ];
    }

    return [];
  }

  function resolveOmpAdditionalSkillPaths(
    skillRoots: readonly AgentRuntimeSkillRoot[] | undefined,
  ): string[] | undefined {
    if (!skillRoots || skillRoots.length === 0) {
      return undefined;
    }
    const paths = skillRoots
      .filter(
        (root): root is AgentRuntimeOmpSkillRoot => root.providerId === "omp",
      )
      .map((root) => root.skillDirectoryRootPath);
    return paths.length > 0 ? paths : undefined;
  }

  function resolveOmpInstructionOverrides(
    command:
      | Extract<AdapterCommand, { type: "thread/start" }>
      | Extract<AdapterCommand, { type: "thread/resume" }>,
  ): { baseInstructions?: string; appendSystemPrompt?: string } {
    const instructions = command.options.instructions;
    if (!instructions) {
      return {};
    }
    return command.instructionMode === "replace"
      ? { baseInstructions: instructions }
      : { appendSystemPrompt: instructions };
  }

  function buildThreadStartParams(
    command:
      | Extract<AdapterCommand, { type: "thread/start" }>
      | Extract<AdapterCommand, { type: "thread/resume" }>,
  ): Record<string, unknown> {
    const additionalSkillPaths = resolveOmpAdditionalSkillPaths(
      command.options.skillRoots,
    );
    const overrides = resolveOmpInstructionOverrides(command);
    const envVars = command.options.envVars;
    return {
      cwd: command.cwd,
      ...(command.options.model ? { model: command.options.model } : {}),
      ...(command.options.reasoningLevel
        ? { reasoningLevel: command.options.reasoningLevel }
        : {}),
      ...(additionalSkillPaths ? { additionalSkillPaths } : {}),
      ...(overrides.baseInstructions
        ? { baseInstructions: overrides.baseInstructions }
        : {}),
      ...(overrides.appendSystemPrompt
        ? { appendSystemPrompt: overrides.appendSystemPrompt }
        : {}),
      ...(envVars && Object.keys(envVars).length > 0 ? { envVars } : {}),
    };
  }

  function buildCommandPlan(command: AdapterCommand): ProviderCommandPlan {
    switch (command.type) {
      case "initialize":
        return {
          kind: "request",
          method: "initialize",
          params: { clientInfo: { name: "bb", version: "1.0.0" } },
        } satisfies ProviderRequestCommandPlan;
      case "model/list":
        return {
          kind: "request",
          method: "model/list",
          params: {},
        } satisfies ProviderRequestCommandPlan;
      case "skills/configure":
        return {
          kind: "noop",
          reason: "omp skill paths are configured per session",
        };
      case "thread/start": {
        finishOpenProviderTurn({
          registry: turnState,
          threadId: command.threadId,
        });
        return {
          kind: "request",
          method: "thread/start",
          params: {
            threadId: command.threadId,
            ...buildThreadStartParams(command),
          },
        };
      }
      case "thread/resume": {
        finishOpenProviderTurn({
          registry: turnState,
          threadId: command.threadId,
        });
        return {
          kind: "request",
          method: "thread/resume",
          params: {
            threadId: command.providerThreadId,
            ...buildThreadStartParams(command),
          },
        };
      }
      case "turn/start":
        return {
          kind: "request",
          method: "turn/start",
          params: {
            threadId: command.providerThreadId,
            input: flattenPromptInputGroups(command.input, command.inputGroups),
            ...(command.options.model ? { model: command.options.model } : {}),
          },
        };
      case "turn/steer":
        return {
          kind: "request",
          method: "turn/steer",
          params: {
            threadId: command.providerThreadId,
            expectedTurnId: command.expectedTurnId,
            input: flattenPromptInputGroups(command.input, command.inputGroups),
          },
        };
      case "thread/stop":
        return {
          kind: "request",
          method: "thread/stop",
          params: { threadId: command.providerThreadId },
        };
      case "thread/name/set":
      case "thread/archive":
      case "thread/unarchive":
      case "thread/fork":
        return {
          kind: "noop",
          reason: `omp does not support ${command.type}`,
        };
    }
  }

  function translateAcceptedCommand(
    args: ProviderAcceptedCommandTranslationArgs,
  ): ThreadEvent[] {
    // omp acks prompts immediately and drives turn lifecycle via agent_start;
    // no synthetic input-accepted event is needed for v1.
    return [];
  }

  const adapter: ProviderAdapter = {
    id: "omp",
    displayName: providerInfo.displayName,
    capabilities,
    process: {
      command: "node",
      args: resolveBridgeProcessArgs({
        importMetaUrl: import.meta.url,
        bridgeRelativePath: "bridge/bridge.js",
        bridgeBundleDir: opts?.bridgeBundleDir,
        bundleFileName: "bb-omp-bridge.mjs",
      }),
      ...(ompBinaryPath ? { env: { BB_OMP_BINARY: ompBinaryPath } } : {}),
    },
    buildCommandPlan,
    prepareTurnStart: noPreparedProviderCommandDispatch,
    parseModelListResult(result: unknown): {
      models: AvailableModel[];
      selectedOnlyModels: AvailableModel[];
    } {
      return parseOmpAvailableModels(result);
    },
    translateEvent: translateOmpEvent,
    translateAcceptedCommand,
    decodeToolCallRequest() {
      // omp tool executions surface as events; bb->omp dynamic tool callbacks
      // (host tools) are a follow-up.
      return null;
    },
  };

  return adapter;
}

