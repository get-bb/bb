/**
 * The one ProviderAdapter for protocol-pure bridges.
 *
 * A bridge that speaks the canonical Provider Bridge Protocol
 * (@bb/provider-bridge-protocol) needs no bespoke adapter: commands map to
 * canonical methods, events arrive as already-translated ThreadEvents, and
 * session-behavior capabilities come from the initialize handshake — captured
 * here per process and consulted for gated methods, so a method a bridge did
 * not advertise is never sent.
 *
 * This adapter never diffs execution options (`classifyExecutionSettingsChange`
 * always reports "live"): options ride every command and the bridge
 * reconciles internally, reporting any session rebuild via the mandatory
 * `session/replaced` notification.
 */
import type { ProviderCapabilities, ThreadEvent } from "@bb/domain";
import { pendingInteractionPayloadSchema, threadEventSchema } from "@bb/domain";
import {
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_NOTIFICATION_METHODS,
  BRIDGE_REQUEST_METHODS,
  bridgeCapabilitiesSchema,
  initializeResultSchema,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  type BridgeCapabilities,
} from "@bb/provider-bridge-protocol";
import { z } from "zod";
import type {
  AdapterCommand,
  BuildInteractiveResponseArgs,
  DecodedInteractiveRequest,
  DecodedToolCallRequest,
  ProviderAdapter,
  ProviderCommandPlan,
  ProviderExecutionContext,
  ProviderInteractiveResponse,
  ProviderPostInitializeRequest,
} from "./provider-adapter.js";
import { noPreparedProviderCommandDispatch } from "./provider-adapter.js";
import type {
  ProviderInboundRequest,
  ProviderRuntimeEvent,
} from "./runtime-json-rpc.js";
import { parseAvailableModelList } from "./shared/available-models.js";

export interface BridgeProtocolAdapterOptions {
  id: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  process: { command: string; args: string[]; env?: Record<string, string> };
}

const threadEventNotificationParamsSchema = z
  .object({ threadId: z.string().min(1), event: threadEventSchema })
  .passthrough();

const threadIdentityNotificationParamsSchema = z
  .object({
    threadId: z.string().min(1),
    providerThreadId: z.string().min(1),
    sessionRestorable: z.boolean().optional(),
  })
  .passthrough();

const sessionReplacedNotificationParamsSchema = z
  .object({
    threadId: z.string().min(1),
    providerThreadId: z.string().min(1).nullable(),
    reason: z.string().min(1),
    contextLost: z.boolean().default(false),
  })
  .passthrough();

const errorNotificationParamsSchema = z
  .object({
    threadId: z.string().min(1).optional(),
    providerThreadId: z.string().min(1).optional(),
    message: z.string().min(1),
  })
  .passthrough();

const toolCallParamsSchema = z.object({
  providerThreadId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  turnId: z.union([z.string().min(1), z.null()]),
  callId: z.string().min(1),
  tool: z.string().min(1),
  arguments: z.unknown(),
});

const interactionRequestParamsSchema = z.object({
  providerThreadId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  turnId: z.union([z.string().min(1), z.null()]),
  payload: pendingInteractionPayloadSchema,
});

/**
 * Execution options → canonical wire options. Core execution fields map
 * one-to-one; every field the shared context still carries for a specific
 * provider travels in the opaque `providerOptions` bag so nothing is lost
 * while the migration is in flight.
 */
function toBridgeWireOptions(
  options: ProviderExecutionContext,
): Record<string, unknown> {
  const {
    model,
    serviceTier,
    reasoningLevel,
    instructions,
    envVars,
    permissionMode,
    permissionScope,
    approvalReviewer,
    permissionEscalation,
    skillRoots: _skillRoots,
    ...providerFlavored
  } = options;
  const providerOptions = Object.fromEntries(
    Object.entries(providerFlavored).filter(([, value]) => value !== undefined),
  );
  return {
    ...(model !== undefined ? { model } : {}),
    ...(serviceTier !== undefined ? { serviceTier } : {}),
    ...(reasoningLevel !== undefined ? { reasoningLevel } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
    ...(envVars !== undefined ? { envVars } : {}),
    permissionMode,
    permissionScope,
    approvalReviewer,
    permissionEscalation,
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
  };
}

export function createBridgeProtocolAdapter(
  options: BridgeProtocolAdapterOptions,
): ProviderAdapter {
  let handshake: BridgeCapabilities = bridgeCapabilitiesSchema.parse({});

  function gate(
    capability: keyof BridgeCapabilities & string,
    plan: ProviderCommandPlan,
  ): ProviderCommandPlan {
    if (handshake[capability] === true) {
      return plan;
    }
    return { kind: "noop", reason: `${capability} not advertised` };
  }

  const adapter: ProviderAdapter = {
    id: options.id,
    displayName: options.displayName,
    capabilities: options.capabilities,
    // The handshake owns approval-policy placement; before it completes the
    // runtime-owned default is the safe reading (every request re-checked).
    get approvalRequestPolicy() {
      return handshake.approvalRequestPolicy;
    },
    process: options.process,

    // Options ride every command; the bridge reconciles internally.
    classifyExecutionSettingsChange: () => "live",

    buildCommandPlan(command: AdapterCommand): ProviderCommandPlan {
      switch (command.type) {
        case "initialize":
          // The real initialize runs as a post-initialize request so the
          // handshake result can be captured (the plain initialize path
          // discards results).
          return { kind: "noop", reason: "initialize handled post-spawn" };
        case "model/list":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.modelList,
            params: command.cwd !== undefined ? { cwd: command.cwd } : {},
          };
        case "skills/configure":
          // Wired in phase 2a: the canonical single-catalog payload replaces
          // per-provider skill-root shapes end to end.
          return { kind: "noop", reason: "canonical skills payload not wired" };
        case "thread/start":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadStart,
            params: {
              threadId: command.threadId,
              cwd: command.cwd,
              ...(command.input !== undefined ? { input: command.input } : {}),
              options: toBridgeWireOptions(command.options),
              ...(command.dynamicTools !== undefined
                ? { dynamicTools: command.dynamicTools }
                : {}),
              ...(command.disallowedTools !== undefined
                ? { disallowedTools: command.disallowedTools }
                : {}),
              instructionMode: command.instructionMode,
            },
          };
        case "thread/resume":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadResume,
            params: {
              threadId: command.threadId,
              cwd: command.cwd,
              providerThreadId: command.providerThreadId,
              options: toBridgeWireOptions(command.options),
              ...(command.dynamicTools !== undefined
                ? { dynamicTools: command.dynamicTools }
                : {}),
              ...(command.disallowedTools !== undefined
                ? { disallowedTools: command.disallowedTools }
                : {}),
              instructionMode: command.instructionMode,
            },
          };
        case "thread/fork":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadFork,
            params: {
              threadId: command.threadId,
              cwd: command.cwd,
              sourceProviderThreadId: command.sourceProviderThreadId,
              ...(command.sourceProviderCheckpointId !== undefined
                ? {
                    sourceProviderCheckpointId:
                      command.sourceProviderCheckpointId,
                  }
                : {}),
              options: toBridgeWireOptions(command.options),
              ...(command.dynamicTools !== undefined
                ? { dynamicTools: command.dynamicTools }
                : {}),
              ...(command.disallowedTools !== undefined
                ? { disallowedTools: command.disallowedTools }
                : {}),
              instructionMode: command.instructionMode,
            },
          };
        case "turn/start":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.turnStart,
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
              input: command.input,
              clientRequestId: command.clientRequestId,
              options: toBridgeWireOptions(command.options),
            },
          };
        case "turn/steer":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.turnSteer,
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
              expectedTurnId: command.expectedTurnId,
              input: command.input,
              clientRequestId: command.clientRequestId,
              options: toBridgeWireOptions(command.options),
            },
          };
        case "thread/stop":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadStop,
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
              // The adapter command predates the daemon-level intent split;
              // a stop with an active turn is an interrupt, an idle stop is
              // a release. Phase 2a threads the daemon's explicit intent
              // through instead.
              intent: command.activeTurnId !== null ? "interrupt" : "release",
              activeTurnId: command.activeTurnId,
            },
          };
        case "thread/discard":
          return {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadDiscard,
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
            },
          };
        case "thread/name/set":
          return gate("nameSync", {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadNameSet,
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
              title: command.title,
            },
          });
        case "thread/archive":
          return gate("archiveSync", {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadArchive,
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
            },
          });
        case "thread/unarchive":
          return gate("archiveSync", {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadUnarchive,
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
            },
          });
        case "thread/goal/clear":
          return gate("goalState", {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.threadGoalClear,
            params: {
              threadId: command.threadId,
              providerThreadId: command.providerThreadId,
            },
          });
      }
    },

    buildPostInitializeRequests(): readonly ProviderPostInitializeRequest[] {
      return [
        {
          required: true,
          plan: {
            kind: "request",
            method: BRIDGE_REQUEST_METHODS.initialize,
            params: {
              protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
              client: { name: "bb", version: "1.0.0" },
            },
          },
          onResult(result) {
            const parsed = initializeResultSchema.safeParse(result);
            if (parsed.success) {
              handshake = parsed.data.capabilities;
            }
          },
        },
      ];
    },

    prepareTurnStart: noPreparedProviderCommandDispatch,

    parseModelListResult: parseAvailableModelList,

    translateEvent(event: ProviderRuntimeEvent): ThreadEvent[] {
      const method = event.method;
      if (method === BRIDGE_NOTIFICATION_METHODS.threadEvent) {
        const parsed = threadEventNotificationParamsSchema.safeParse(
          event.params,
        );
        return parsed.success ? [parsed.data.event] : [];
      }
      if (method === BRIDGE_NOTIFICATION_METHODS.threadIdentity) {
        const parsed = threadIdentityNotificationParamsSchema.safeParse(
          event.params,
        );
        if (!parsed.success) {
          return [];
        }
        return [
          {
            type: "thread/identity",
            threadId: parsed.data.threadId,
            providerThreadId: parsed.data.providerThreadId,
            scope: { kind: "thread" },
          },
        ];
      }
      if (method === BRIDGE_NOTIFICATION_METHODS.sessionReplaced) {
        const parsed = sessionReplacedNotificationParamsSchema.safeParse(
          event.params,
        );
        if (!parsed.success || parsed.data.providerThreadId === null) {
          return [];
        }
        return [
          {
            type: "provider/warning",
            threadId: parsed.data.threadId,
            providerThreadId: parsed.data.providerThreadId,
            category: "general",
            summary: parsed.data.contextLost
              ? "Provider session was replaced; provider-side context was lost."
              : "Provider session was replaced.",
            details: parsed.data.reason,
            scope: { kind: "thread" },
          },
        ];
      }
      if (method === BRIDGE_NOTIFICATION_METHODS.error) {
        const parsed = errorNotificationParamsSchema.safeParse(event.params);
        if (
          !parsed.success ||
          parsed.data.threadId === undefined ||
          parsed.data.providerThreadId === undefined
        ) {
          return [];
        }
        return [
          {
            type: "provider/warning",
            threadId: parsed.data.threadId,
            providerThreadId: parsed.data.providerThreadId,
            category: "general",
            summary: parsed.data.message,
            scope: { kind: "thread" },
          },
        ];
      }
      // provider/raw is droppable diagnostics by contract; anything else is
      // forward skew from a newer bridge and is ignored the same way.
      return [];
    },

    // Canonical bridges emit turn/input/accepted and session-lifecycle events
    // themselves; the adapter synthesizes nothing.
    translateAcceptedCommand: () => [],

    decodeToolCallRequest(
      request: ProviderInboundRequest,
    ): DecodedToolCallRequest | null {
      if (
        request.method !== BRIDGE_INBOUND_REQUEST_METHODS.toolCall ||
        (typeof request.id !== "string" && typeof request.id !== "number")
      ) {
        return null;
      }
      const parsed = toolCallParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return null;
      }
      return {
        requestId: request.id,
        providerThreadId: parsed.data.providerThreadId,
        turnId: parsed.data.turnId,
        callId: parsed.data.callId,
        tool: parsed.data.tool,
        ...(parsed.data.arguments !== undefined
          ? { arguments: parsed.data.arguments }
          : {}),
        ...(parsed.data.threadId ? { threadId: parsed.data.threadId } : {}),
      };
    },

    decodeInteractiveRequest(
      request: ProviderInboundRequest,
    ): DecodedInteractiveRequest | null {
      if (
        request.method !== BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest ||
        (typeof request.id !== "string" && typeof request.id !== "number")
      ) {
        return null;
      }
      const parsed = interactionRequestParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return null;
      }
      return {
        requestId: request.id,
        method: request.method,
        providerThreadId: parsed.data.providerThreadId,
        turnId: parsed.data.turnId,
        payload: parsed.data.payload,
        ...(parsed.data.threadId ? { threadId: parsed.data.threadId } : {}),
      };
    },

    buildInteractiveResponse(
      args: BuildInteractiveResponseArgs,
    ): ProviderInteractiveResponse {
      // The wire response IS the canonical resolution. The cast is a genuine
      // boundary: PendingInteractionResolution is plain JSON data but TS
      // cannot prove assignability into the recursive wire-response type.
      return args.resolution as unknown as ProviderInteractiveResponse;
    },
  };

  return adapter;
}
