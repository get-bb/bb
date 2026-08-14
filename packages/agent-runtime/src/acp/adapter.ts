/**
 * ACP provider adapter.
 *
 * Maps between bb's ProviderAdapter contract and the generic ACP bridge
 * process; the adapter binds a profile's agent command into each bridge
 * session. The agent owns tool execution. CLI-style agents such as Cursor keep
 * reasoning in model-id variants selected at launch. ACP-native agents can
 * instead expose model and thought-level config options over the protocol.
 */

import {
  buildAcpProviderInfo,
  getBuiltInAgentProviderInfo,
  isAgentProviderId,
} from "@bb/agent-providers";
import { isStandaloneBuiltinCompactCommand } from "@bb/domain";
import type {
  AdapterCommand,
  DecodedInteractiveRequest,
  ProviderAdapter,
} from "../provider-adapter.js";
import { flattenPromptInputGroups } from "../provider-adapter.js";
import { classifySessionExecutionSettingsChange } from "../execution-options.js";
import { ProviderResponseEncodeError } from "../runtime-json-rpc.js";
import type { ProviderInboundRequest } from "../runtime-json-rpc.js";
import { resolveBridgeProcessArgs } from "../shared/bridge-path.js";
import { createStandardAdapterMembers } from "../shared/standard-adapter-members.js";
import { finishOpenProviderTurn } from "../shared/turn-state.js";
import {
  ACP_PERMISSION_REQUEST_METHOD,
  acpPermissionRequestParamsSchema,
} from "./bridge-protocol.js";
import { createAcpEventTranslator } from "./event-translation.js";
import {
  buildAcpPermissionInteractionPayload,
  resolveAcpPermissionDecision,
} from "./interactions.js";
import type { AcpAgentProfile } from "./profiles.js";
import {
  buildAcpModelListParams,
  buildAcpSessionParams,
} from "./session-params.js";

// ---------------------------------------------------------------------------
// Adapter factory options & per-thread state
// ---------------------------------------------------------------------------

export interface CreateAcpProviderAdapterOptions {
  profile: AcpAgentProfile;
  /** Extra roots (beyond the workspace) where client fs writes are allowed. */
  additionalWorkspaceWriteRoots: readonly string[];
  /** Override the directory containing bundled bridge files. */
  bridgeBundleDir?: string;
  /** Optional environment values needed by the Node runtime that launches the bridge. */
  bridgeNodeEnv?: Record<string, string>;
  /** Optional executable used to run the Node bridge process. */
  bridgeNodeExecutablePath?: string;
  /** Prefix for bb-owned turn ids emitted by this adapter instance. */
  turnIdPrefix?: string;
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export function createAcpProviderAdapter(
  opts: CreateAcpProviderAdapterOptions,
): ProviderAdapter {
  const profile = opts.profile;
  const providerInfo = isAgentProviderId(profile.providerId)
    ? getBuiltInAgentProviderInfo(profile.providerId)
    : buildAcpProviderInfo({
        id: profile.providerId,
        displayName: profile.displayName,
        logoUrl: null,
      });
  const additionalWorkspaceWriteRoots = opts.additionalWorkspaceWriteRoots;

  const { translateAcpEvent, turnState } = createAcpEventTranslator({
    providerId: profile.providerId,
    turnIdPrefix: opts.turnIdPrefix,
  });

  function buildSessionParams(
    command: Extract<
      AdapterCommand,
      { type: "thread/start" | "thread/resume" | "thread/fork" }
    >,
  ): Record<string, unknown> {
    return buildAcpSessionParams({
      additionalWorkspaceWriteRoots,
      cwd: command.cwd,
      dynamicTools: command.dynamicTools,
      options: command.options,
      profile,
      providerLabel: providerInfo.id,
      threadId: command.threadId,
    });
  }

  return {
    ...createStandardAdapterMembers({
      id: providerInfo.id,
      displayName: providerInfo.displayName,
      capabilities: providerInfo.capabilities,
      approvalRequestPolicy: "runtime",
      classifyExecutionSettingsChange: classifySessionExecutionSettingsChange,
      process: {
        command: opts.bridgeNodeExecutablePath ?? "node",
        args: resolveBridgeProcessArgs({
          bridgeBundleDir: opts.bridgeBundleDir,
          bundleFileName: "bb-acp-bridge.mjs",
          importMetaUrl: import.meta.url,
          bridgeRelativePath: "bridge/bridge.js",
        }),
        ...(opts.bridgeNodeEnv !== undefined
          ? { env: opts.bridgeNodeEnv }
          : {}),
      },
      initializeParams: { clientInfo: { name: "bb", version: "1.0.0" } },
      codec: "normalized",
      turnState,
      translateEvent: translateAcpEvent,
      buildProviderCommandPlan(command) {
        switch (command.type) {
          case "model/list":
            return {
              kind: "request",
              method: "model/list",
              params: buildAcpModelListParams(profile),
            };
          case "skills/configure":
            return {
              kind: "noop",
              reason: "ACP skills are delivered through session instructions",
            };
          case "thread/start": {
            finishOpenProviderTurn({
              registry: turnState,
              threadId: command.threadId,
            });
            return {
              kind: "request",
              method: "thread/start",
              params: buildSessionParams(command),
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
                ...buildSessionParams(command),
                providerThreadId: command.providerThreadId,
              },
            };
          }
          case "thread/fork": {
            finishOpenProviderTurn({
              registry: turnState,
              threadId: command.threadId,
            });
            return {
              kind: "request",
              method: "thread/fork",
              params: {
                ...buildSessionParams(command),
                sourceProviderThreadId: command.sourceProviderThreadId,
                ...(command.sourceProviderCheckpointId !== undefined
                  ? {
                      sourceProviderCheckpointId:
                        command.sourceProviderCheckpointId,
                    }
                  : {}),
              },
            };
          }
          case "turn/start": {
            const input = flattenPromptInputGroups(
              command.input,
              command.inputGroups,
            );
            if (
              profile.providerId === "acp-opencode" &&
              isStandaloneBuiltinCompactCommand(input)
            ) {
              return {
                kind: "request",
                method: "thread/compact",
                params: { threadId: command.providerThreadId },
              };
            }
            return {
              kind: "request",
              method: "turn/start",
              params: {
                threadId: command.providerThreadId,
                input,
              },
            };
          }
          case "turn/steer":
            return {
              kind: "request",
              method: "turn/steer",
              params: {
                threadId: command.providerThreadId,
                expectedTurnId: command.expectedTurnId,
                input: flattenPromptInputGroups(
                  command.input,
                  command.inputGroups,
                ),
              },
            };
          case "thread/stop":
            finishOpenProviderTurn({
              registry: turnState,
              threadId: command.threadId,
            });
            return {
              kind: "request",
              method: "thread/stop",
              params: { threadId: command.providerThreadId },
            };
          case "thread/discard":
            return { kind: "noop", reason: "discard unsupported" };
          default:
            return null;
        }
      },
    }),
    clearActiveTurnState(threadId) {
      finishOpenProviderTurn({ registry: turnState, threadId });
    },

    decodeInteractiveRequest(
      request: ProviderInboundRequest,
    ): DecodedInteractiveRequest | null {
      if (typeof request.id !== "string" && typeof request.id !== "number") {
        return null;
      }
      if (request.method !== ACP_PERMISSION_REQUEST_METHOD) {
        return null;
      }
      const parsed = acpPermissionRequestParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return null;
      }
      return {
        requestId: request.id,
        method: request.method,
        threadId: parsed.data.threadId,
        providerThreadId: parsed.data.providerThreadId,
        turnId: parsed.data.turnId,
        payload: buildAcpPermissionInteractionPayload({
          toolCall: parsed.data.toolCall,
          options: parsed.data.options,
        }),
      };
    },

    buildInteractiveResponse(args) {
      const response = resolveAcpPermissionDecision({
        payload: args.request.payload,
        resolution: args.resolution,
      });
      if (response === null) {
        throw new ProviderResponseEncodeError(
          "ACP interactive response kind does not match the request payload",
        );
      }
      return response;
    },
  };
}
