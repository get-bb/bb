/**
 * ACP provider adapter.
 *
 * Maps between bb's ProviderAdapter contract and the generic ACP bridge
 * process; the adapter binds a profile's agent command into each bridge
 * session. The agent owns tool execution. CLI-style agents such as Cursor keep
 * reasoning in model-id variants selected at launch. ACP-native agents can
 * instead expose model and thought-level config options over the protocol.
 */

import path from "node:path";
import {
  buildAcpProviderInfo,
  getBuiltInAgentProviderInfo,
  isAgentProviderId,
} from "@bb/agent-providers";
import type { PendingInteractionApprovalDecision } from "@bb/domain";
import {
  isApprovalPendingInteractionPayload,
  isApprovalPendingInteractionResolution,
  isStandaloneBuiltinCompactCommand,
} from "@bb/domain";
import type {
  AdapterCommand,
  DecodedInteractiveRequest,
  ProviderAdapter,
  ProviderExecutionContext,
} from "../provider-adapter.js";
import { flattenPromptInputGroups } from "../provider-adapter.js";
import { classifySessionExecutionSettingsChange } from "../execution-options.js";
import { ProviderResponseEncodeError } from "../runtime-json-rpc.js";
import type { ProviderInboundRequest } from "../runtime-json-rpc.js";
import { toOptionalString } from "../shared/adapter-utils.js";
import { resolveBridgeProcessArgs } from "../shared/bridge-path.js";
import { createStandardAdapterMembers } from "../shared/standard-adapter-members.js";
import { finishOpenProviderTurn } from "../shared/turn-state.js";
import type {
  AgentRuntimeAcpSkillRoot,
  AgentRuntimeSkillRoot,
} from "../types.js";
import {
  ACP_PERMISSION_REQUEST_METHOD,
  acpPermissionRequestParamsSchema,
  ACP_DEFAULT_MODEL_ID,
  type AcpPermissionRequestParams,
  type AcpPermissionResponse,
} from "./bridge-protocol.js";
import { createAcpEventTranslator } from "./event-translation.js";
import type { AcpAgentProfile } from "./profiles.js";

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

function buildAcpApprovalDecisions(
  params: AcpPermissionRequestParams,
): PendingInteractionApprovalDecision[] {
  const kinds = new Set(params.options.map((option) => option.kind));
  const decisions: PendingInteractionApprovalDecision[] = [];
  if (kinds.has("allow_once")) {
    decisions.push("allow_once");
  }
  if (kinds.has("allow_always")) {
    decisions.push("allow_for_session");
  }
  if (kinds.has("reject_once") || kinds.has("reject_always")) {
    decisions.push("deny");
  }
  // An options list with a single odd kind still needs one decision; fall back
  // to deny so the runtime's auto-deny policy can always settle the request.
  return decisions.length > 0 ? decisions : ["deny"];
}

function buildOpaqueAcpPermissionCommand(toolCall: {
  command?: string;
  title?: string;
  kind?: string;
}): string {
  return (
    toOptionalString(toolCall.command) ??
    toOptionalString(toolCall.title) ??
    toolCall.kind ??
    "ACP permission request"
  );
}

function requireAcpSkillRoot(
  skillRoot: AgentRuntimeSkillRoot,
): AgentRuntimeAcpSkillRoot {
  if (skillRoot.providerId !== "acp") {
    throw new Error(
      `ACP cannot configure ${skillRoot.providerId} skill root "${skillRoot.id}".`,
    );
  }
  return skillRoot;
}

function sanitizeAcpSkillDescription(description: string): string {
  const sanitized = description
    .replace(/[\r\n]+/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/[<>]/gu, "")
    .trim();
  return sanitized.length > 0 ? sanitized : "(description unavailable)";
}

function buildAcpSkillsInstructions(
  skillRoots: ProviderExecutionContext["skillRoots"],
): string | undefined {
  if (!skillRoots || skillRoots.length === 0) {
    return undefined;
  }

  const skillLines = skillRoots.flatMap((skillRoot) => {
    const acpSkillRoot = requireAcpSkillRoot(skillRoot);
    return acpSkillRoot.skills.map((skill) => {
      const skillFilePath = path.join(
        acpSkillRoot.skillDirectoryRootPath,
        skill.name,
        "SKILL.md",
      );
      return `- ${skill.name}: ${sanitizeAcpSkillDescription(skill.description)} (SKILL.md: ${skillFilePath})`;
    });
  });
  if (skillLines.length === 0) {
    return undefined;
  }

  return [
    "bb skills are reusable instruction folders. When the current task matches a listed skill description, read that skill's SKILL.md at the absolute path before proceeding; you may read supporting files in the same skill directory that SKILL.md references. If a listed path does not exist, the list is stale and should be ignored.",
    "",
    "Available bb skills:",
    ...skillLines,
  ].join("\n");
}

function buildAcpSessionInstructions(
  options: ProviderExecutionContext,
): string | undefined {
  const baseInstructions = options.instructions?.trim();
  const skillsInstructions = buildAcpSkillsInstructions(options.skillRoots);
  const instructions = [baseInstructions, skillsInstructions].filter(
    (value): value is string => value !== undefined && value.length > 0,
  );
  return instructions.length > 0 ? instructions.join("\n\n") : undefined;
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

  function buildModelListCommand():
    | {
        command: string;
        args: string[];
        cwd?: string;
        envVars?: Record<string, string>;
      }
    | undefined {
    if (!profile.modelCli || profile.modelCli.listArgs.length === 0) {
      return undefined;
    }
    return {
      command: profile.agentCommand.command,
      args: [...profile.modelCli.listArgs],
      ...(profile.cwd !== undefined ? { cwd: profile.cwd } : {}),
      ...(profile.env !== undefined ? { envVars: profile.env } : {}),
    };
  }

  function buildModelDiscoveryAgentCommand():
    | {
        command: string;
        args: string[];
        cwd?: string;
        envVars?: Record<string, string>;
      }
    | undefined {
    if (buildModelListCommand() !== undefined) {
      return undefined;
    }
    return {
      command: profile.agentCommand.command,
      args: [...profile.agentCommand.args],
      ...(profile.cwd !== undefined ? { cwd: profile.cwd } : {}),
      ...(profile.env !== undefined ? { envVars: profile.env } : {}),
    };
  }

  function buildReasoningCliParam(): Record<string, unknown> {
    return profile.reasoningCli === undefined
      ? {}
      : { reasoningCli: profile.reasoningCli };
  }

  function buildNativeReasoningParam(): Record<string, unknown> {
    return profile.nativeReasoning === undefined
      ? {}
      : { nativeReasoning: profile.nativeReasoning };
  }

  function buildPermissionCliParam(): Record<string, unknown> {
    return profile.permissionCli === undefined
      ? {}
      : { permissionCli: profile.permissionCli };
  }

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
    const instructions = buildAcpSessionInstructions(command.options);
    const cwd = profile.cwd ?? command.cwd;
    const envVars = {
      ...(profile.env ?? {}),
      ...(command.options.envVars ?? {}),
    };
    if (command.options.permissionMode === "auto") {
      throw new Error(
        `Provider "${providerInfo.id}" does not support permission mode "auto".`,
      );
    }
    return {
      threadId: command.threadId,
      cwd,
      agent: {
        command: profile.agentCommand.command,
        args: [...profile.agentCommand.args],
      },
      ...buildModelSelectionParam(command.options),
      ...buildReasoningCliParam(),
      ...buildNativeReasoningParam(),
      ...buildPermissionCliParam(),
      ...(profile.reasoningCli !== undefined &&
      command.options.reasoningLevel !== undefined
        ? { launchReasoningLevel: command.options.reasoningLevel }
        : {}),
      permissionMode: command.options.permissionMode,
      permissionEscalation: command.options.permissionEscalation,
      workspaceWriteRoots: [cwd, ...additionalWorkspaceWriteRoots],
      ...(Object.keys(envVars).length > 0 ? { envVars } : {}),
      ...(instructions ? { instructions } : {}),
      ...(command.dynamicTools && command.dynamicTools.length > 0
        ? { dynamicTools: command.dynamicTools }
        : {}),
    };
  }

  /**
   * Session-level model pin for the bridge. CLI-style agents use launch flags;
   * ACP-native agents receive the selected model over the protocol. The
   * synthetic "acp-default" id is never forwarded.
   */
  function buildModelSelectionParam(
    options: ProviderExecutionContext,
  ): Record<string, unknown> {
    const model = options.model;
    const listCommand = buildModelListCommand();
    if (!model || model === ACP_DEFAULT_MODEL_ID) {
      return {};
    }
    if (!listCommand || !profile.modelCli?.selectFlag) {
      return {
        modelSelection: {
          modelId: model,
          ...(options.reasoningLevel !== undefined
            ? { reasoningLevel: options.reasoningLevel }
            : {}),
        },
      };
    }
    // Cursor encodes reasoning in the selected model id and has no ACP
    // `thought_level` option; keep that CLI variant path separate from native
    // ACP config-option reasoning.
    return {
      modelSelection: {
        listCommand,
        selectFlag: profile.modelCli.selectFlag,
        model,
        ...(options.reasoningLevel !== undefined
          ? { reasoningLevel: options.reasoningLevel }
          : {}),
        // Only "fast" changes resolution; "default" is the catalog's normal id.
        ...(options.serviceTier === "fast"
          ? { serviceTier: options.serviceTier }
          : {}),
      },
    };
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
            const listCommand = buildModelListCommand();
            const agent = buildModelDiscoveryAgentCommand();
            return {
              kind: "request",
              method: "model/list",
              params: {
                ...(listCommand !== undefined ? { listCommand } : {}),
                ...(agent !== undefined ? { agent } : {}),
                primaryModels: [...(profile.modelCli?.primaryModels ?? [])],
                ...buildReasoningCliParam(),
                ...buildNativeReasoningParam(),
              },
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
      const toolCall = parsed.data.toolCall;
      const command = toolCall
        ? buildOpaqueAcpPermissionCommand(toolCall)
        : "ACP permission request";
      return {
        requestId: request.id,
        method: request.method,
        threadId: parsed.data.threadId,
        providerThreadId: parsed.data.providerThreadId,
        turnId: parsed.data.turnId,
        payload: {
          kind: "approval",
          subject: {
            kind: "command",
            itemId: toolCall?.toolCallId ?? "acp-permission",
            command,
            cwd: null,
            actions: [{ type: "unknown", command }],
            sessionGrant: null,
          },
          reason: null,
          availableDecisions: buildAcpApprovalDecisions(parsed.data),
        },
      };
    },

    buildInteractiveResponse(args) {
      if (
        !isApprovalPendingInteractionPayload(args.request.payload) ||
        !isApprovalPendingInteractionResolution(args.resolution)
      ) {
        throw new ProviderResponseEncodeError(
          "ACP interactive response kind does not match the request payload",
        );
      }
      const response: AcpPermissionResponse = {
        decision: args.resolution.decision,
      };
      return response;
    },
  };
}
