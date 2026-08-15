/**
 * Claude Code provider adapter.
 *
 * Maps between bb's ProviderAdapter contract and the Claude Code SDK bridge
 * process. The bridge communicates via JSON-RPC over stdin/stdout. Event
 * translation lives in `./event-translation.ts` (shared with the bridge's
 * canonical Provider Bridge Protocol surface); the adapter delegates to one
 * translator instance and owns only command-plan construction and the legacy
 * interactive-request decode.
 */

import { getBuiltInAgentProviderInfo } from "@bb/agent-providers";
import type { PromptInput } from "@bb/domain";
import { removeCommandMentionsFromPromptInput } from "@bb/domain";
import { resolveBridgeProcessArgs } from "../shared/bridge-path.js";
import { createStandardAdapterMembers } from "../shared/standard-adapter-members.js";
import { finishOpenProviderTurn } from "../shared/turn-state.js";
import type {
  DecodedInteractiveRequest,
  ProviderExecutionContext,
  ProviderAdapter,
  ProviderAdapterFactoryOptions,
} from "../provider-adapter.js";
import {
  classifyClaudeExecutionSettingsChange,
  normalizeClaudeExecutionOptions,
} from "../execution-options.js";
import type { ProviderInboundRequest } from "../runtime-json-rpc.js";
import {
  CLAUDE_PERMISSION_REQUEST_APPROVAL_METHOD,
  CLAUDE_USER_QUESTION_REQUEST_METHOD,
  claudePermissionRequestApprovalParamsSchema,
  claudeUserQuestionRequestParamsSchema,
} from "./interactive-contract.js";
import { createClaudeEventTranslator } from "./event-translation.js";
import {
  buildClaudeApprovalInteractionPayload,
  buildClaudeInteractiveResponse,
  buildClaudeUserQuestionPayload,
} from "./interactions.js";
import { buildClaudeSessionParams } from "./session-params.js";
import {
  buildInterruptedClaudeTaskEvents,
  hasOpenClaudeBackgroundTasks,
} from "./task-translation.js";

// ---------------------------------------------------------------------------
// Claude Code–specific helpers
// ---------------------------------------------------------------------------

function stripClaudePlanCommandInput(
  input: readonly PromptInput[],
  options: ProviderExecutionContext,
): PromptInput[] {
  if (options.claudeCodePermissionMode !== "plan") {
    return [...input];
  }
  return removeCommandMentionsFromPromptInput(input, {
    trigger: "/",
    name: "plan",
  });
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export interface CreateClaudeCodeProviderAdapterOptions extends ProviderAdapterFactoryOptions {
  /** Override the directory containing bundled bridge files. */
  bridgeBundleDir?: string;
  /** Prefix for bb-owned turn ids emitted by this adapter instance. */
  turnIdPrefix?: string;
}

export function createClaudeCodeProviderAdapter(
  opts?: CreateClaudeCodeProviderAdapterOptions,
): ProviderAdapter {
  const additionalWorkspaceWriteRoots =
    opts?.additionalWorkspaceWriteRoots ?? [];
  const providerInfo = getBuiltInAgentProviderInfo("claude-code");
  const capabilities = providerInfo.capabilities;

  const {
    resolveClaudeInteractiveRequestTurnId,
    setClaudeModelContextWindowHint,
    translateClaudeEvent,
    turnState,
  } = createClaudeEventTranslator({
    providerId: "claude-code",
    turnIdPrefix: opts?.turnIdPrefix,
  });

  return {
    ...createStandardAdapterMembers({
      id: providerInfo.id,
      displayName: providerInfo.displayName,
      capabilities,
      approvalRequestPolicy: "provider",
      classifyExecutionSettingsChange: classifyClaudeExecutionSettingsChange,
      normalizeExecutionOptions: normalizeClaudeExecutionOptions,
      process: {
        command: opts?.bridgeNodeExecutablePath ?? "node",
        args: resolveBridgeProcessArgs({
          bridgeBundleDir: opts?.bridgeBundleDir,
          bundleFileName: "bb-claude-code-bridge.mjs",
          importMetaUrl: import.meta.url,
          bridgeRelativePath: "bridge/bridge.js",
        }),
        ...(opts?.bridgeNodeEnv !== undefined
          ? { env: opts.bridgeNodeEnv }
          : {}),
      },
      initializeParams: { clientInfo: { name: "bb", version: "1.0.0" } },
      codec: "normalized",
      turnState,
      translateEvent: translateClaudeEvent,
      onSessionReplace: ({ command, state }) => {
        // Replacing the CLI session kills background tasks with it.
        const events = buildInterruptedClaudeTaskEvents({
          tasks: state.tasksById,
          threadId: command.threadId,
        });
        state.opaqueTaskIds.clear();
        return events;
      },
      buildProviderCommandPlan(command) {
        switch (command.type) {
          case "model/list":
            return {
              kind: "request",
              method: "model/list",
              params: {},
            };
          case "skills/configure":
            return {
              kind: "noop",
              reason: "Claude Code skill roots are configured per session",
            };
          case "thread/start": {
            finishOpenProviderTurn({
              registry: turnState,
              threadId: command.threadId,
            });
            if (command.options?.model) {
              setClaudeModelContextWindowHint(
                command.threadId,
                command.options.model,
              );
            }
            return {
              kind: "request",
              method: "thread/start",
              params: buildClaudeSessionParams({
                additionalWorkspaceWriteRoots,
                cwd: command.cwd,
                disallowedTools: command.disallowedTools,
                dynamicTools: command.dynamicTools,
                instructionMode: command.instructionMode,
                options: command.options,
                threadId: command.threadId,
              }),
            };
          }
          case "thread/resume": {
            finishOpenProviderTurn({
              registry: turnState,
              threadId: command.threadId,
            });
            if (command.options?.model) {
              setClaudeModelContextWindowHint(
                command.threadId,
                command.options.model,
              );
            }
            return {
              kind: "request",
              method: "thread/resume",
              params: {
                ...buildClaudeSessionParams({
                  additionalWorkspaceWriteRoots,
                  cwd: command.cwd,
                  disallowedTools: command.disallowedTools,
                  dynamicTools: command.dynamicTools,
                  instructionMode: command.instructionMode,
                  options: command.options,
                  threadId: command.threadId,
                }),
                providerThreadId: command.providerThreadId,
              },
            };
          }
          case "turn/start":
            if (command.options?.model) {
              setClaudeModelContextWindowHint(
                command.threadId,
                command.options.model,
              );
            }
            return {
              kind: "request",
              method: "turn/start",
              params: {
                threadId: command.threadId,
                providerThreadId: command.providerThreadId,
                input: stripClaudePlanCommandInput(
                  command.input,
                  command.options,
                ),
                ...(command.inputGroups !== undefined
                  ? {
                      inputGroups: command.inputGroups.map((inputGroup) =>
                        stripClaudePlanCommandInput(
                          inputGroup,
                          command.options,
                        ),
                      ),
                    }
                  : {}),
                ...(command.options?.model
                  ? { model: command.options.model }
                  : {}),
                ...(command.options?.reasoningLevel
                  ? { reasoningLevel: command.options.reasoningLevel }
                  : {}),
                workflowsEnabled: command.options.workflowsEnabled,
                memoryEnabled: command.options.memoryEnabled,
                providerSubagentsEnabled:
                  command.options.providerSubagentsEnabled,
                permissionEscalation: command.options.permissionEscalation,
              },
            };
          case "turn/steer":
            return {
              kind: "request",
              method: "turn/steer",
              params: {
                threadId: command.threadId,
                providerThreadId: command.providerThreadId,
                expectedTurnId: command.expectedTurnId,
                input: stripClaudePlanCommandInput(
                  command.input,
                  command.options,
                ),
                ...(command.inputGroups !== undefined
                  ? {
                      inputGroups: command.inputGroups.map((inputGroup) =>
                        stripClaudePlanCommandInput(
                          inputGroup,
                          command.options,
                        ),
                      ),
                    }
                  : {}),
                ...(command.options?.model
                  ? { model: command.options.model }
                  : {}),
                ...(command.options?.reasoningLevel
                  ? { reasoningLevel: command.options.reasoningLevel }
                  : {}),
                workflowsEnabled: command.options.workflowsEnabled,
                memoryEnabled: command.options.memoryEnabled,
                providerSubagentsEnabled:
                  command.options.providerSubagentsEnabled,
                permissionEscalation: command.options.permissionEscalation,
              },
            };
          case "thread/fork": {
            finishOpenProviderTurn({
              registry: turnState,
              threadId: command.threadId,
            });
            if (command.options?.model) {
              setClaudeModelContextWindowHint(
                command.threadId,
                command.options.model,
              );
            }
            return {
              kind: "request",
              method: "thread/fork",
              params: {
                ...buildClaudeSessionParams({
                  additionalWorkspaceWriteRoots,
                  cwd: command.cwd,
                  disallowedTools: command.disallowedTools,
                  dynamicTools: command.dynamicTools,
                  instructionMode: command.instructionMode,
                  options: command.options,
                  threadId: command.threadId,
                }),
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
          case "thread/stop":
            finishOpenProviderTurn({
              registry: turnState,
              threadId: command.threadId,
            });
            return {
              kind: "request",
              method: "thread/stop",
              params: {
                threadId: command.threadId,
              },
            };
          case "thread/discard":
            return {
              kind: "request",
              method: "thread/stop",
              params: { threadId: command.threadId },
            };
          default:
            return null;
        }
      },
    }),

    buildThreadDetachedEvents({ threadId }) {
      const state = turnState.get({ threadId });
      if (!state) {
        return [];
      }
      const events = buildInterruptedClaudeTaskEvents({
        tasks: state.tasksById,
        threadId,
      });
      state.opaqueTaskIds.clear();
      return events;
    },

    hasOpenThreadWork({ threadId }) {
      const state = turnState.get({ threadId });
      return (
        state !== null &&
        (hasOpenClaudeBackgroundTasks(state.tasksById) ||
          state.opaqueTaskIds.size > 0)
      );
    },

    decodeInteractiveRequest(
      request: ProviderInboundRequest,
    ): DecodedInteractiveRequest | null {
      if (typeof request.id !== "string" && typeof request.id !== "number") {
        return null;
      }

      switch (request.method) {
        case CLAUDE_PERMISSION_REQUEST_APPROVAL_METHOD: {
          const parsed = claudePermissionRequestApprovalParamsSchema.safeParse(
            request.params,
          );
          if (!parsed.success) {
            return null;
          }
          const turnId = resolveClaudeInteractiveRequestTurnId({
            threadId: parsed.data.threadId,
            turnId: parsed.data.turnId,
          });
          if (turnId === null) {
            return null;
          }
          return {
            requestId: request.id,
            method: request.method,
            threadId: parsed.data.threadId,
            providerThreadId: parsed.data.providerThreadId,
            turnId,
            payload: buildClaudeApprovalInteractionPayload(parsed.data),
          };
        }
        case CLAUDE_USER_QUESTION_REQUEST_METHOD: {
          const parsed = claudeUserQuestionRequestParamsSchema.safeParse(
            request.params,
          );
          if (!parsed.success) {
            return null;
          }
          const turnId = resolveClaudeInteractiveRequestTurnId({
            threadId: parsed.data.threadId,
            turnId: parsed.data.turnId,
          });
          if (turnId === null) {
            return null;
          }
          return {
            requestId: request.id,
            method: request.method,
            threadId: parsed.data.threadId,
            providerThreadId: parsed.data.providerThreadId,
            turnId,
            payload: buildClaudeUserQuestionPayload(parsed.data),
          };
        }
        default:
          return null;
      }
    },

    buildInteractiveResponse(args) {
      return buildClaudeInteractiveResponse({
        payload: args.request.payload,
        resolution: args.resolution,
      });
    },
  };
}
