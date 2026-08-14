/**
 * ACP session/model-list parameter mapping.
 *
 * Builds the ACP bridge's internal session-construction and model-list params
 * from an agent profile plus execution options. Extracted from the ACP adapter
 * so the adapter (legacy dialect) and the bridge's canonical Provider Bridge
 * Protocol handlers share one mapping, the same pattern as the event-translator
 * extraction.
 */

import path from "node:path";
import type {
  DynamicTool,
  PermissionEscalation,
  PermissionMode,
  ReasoningLevel,
  ServiceTier,
} from "@bb/domain";
import type {
  AgentRuntimeAcpSkillRoot,
  AgentRuntimeSkillRoot,
} from "../types.js";
import { ACP_DEFAULT_MODEL_ID } from "./bridge-protocol.js";
import type { AcpAgentProfile } from "./profiles.js";

/**
 * The execution-option subset the ACP session mapping reads. Structurally
 * satisfied by both the adapter's `ProviderExecutionContext` and the canonical
 * wire options (`bridgeExecutionOptionsSchema` output).
 */
export interface AcpSessionExecutionOptions {
  model?: string | undefined;
  serviceTier?: ServiceTier | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  instructions?: string | undefined;
  envVars?: Record<string, string> | undefined;
  permissionMode: PermissionMode;
  permissionEscalation: PermissionEscalation | null;
  skillRoots?: readonly AgentRuntimeSkillRoot[] | undefined;
}

interface AcpAgentCommandParam {
  command: string;
  args: string[];
  cwd?: string;
  envVars?: Record<string, string>;
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
  skillRoots: readonly AgentRuntimeSkillRoot[] | undefined,
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
  options: AcpSessionExecutionOptions,
): string | undefined {
  const baseInstructions = options.instructions?.trim();
  const skillsInstructions = buildAcpSkillsInstructions(options.skillRoots);
  const instructions = [baseInstructions, skillsInstructions].filter(
    (value): value is string => value !== undefined && value.length > 0,
  );
  return instructions.length > 0 ? instructions.join("\n\n") : undefined;
}

export function buildAcpModelListCommand(
  profile: AcpAgentProfile,
): AcpAgentCommandParam | undefined {
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

export function buildAcpModelDiscoveryAgentCommand(
  profile: AcpAgentProfile,
): AcpAgentCommandParam | undefined {
  if (buildAcpModelListCommand(profile) !== undefined) {
    return undefined;
  }
  return {
    command: profile.agentCommand.command,
    args: [...profile.agentCommand.args],
    ...(profile.cwd !== undefined ? { cwd: profile.cwd } : {}),
    ...(profile.env !== undefined ? { envVars: profile.env } : {}),
  };
}

/** `model/list` request params for the bridge, derived from the profile. */
export function buildAcpModelListParams(
  profile: AcpAgentProfile,
): Record<string, unknown> {
  const listCommand = buildAcpModelListCommand(profile);
  const agent = buildAcpModelDiscoveryAgentCommand(profile);
  return {
    ...(listCommand !== undefined ? { listCommand } : {}),
    ...(agent !== undefined ? { agent } : {}),
    primaryModels: [...(profile.modelCli?.primaryModels ?? [])],
    ...(profile.reasoningCli !== undefined
      ? { reasoningCli: profile.reasoningCli }
      : {}),
    ...(profile.nativeReasoning !== undefined
      ? { nativeReasoning: profile.nativeReasoning }
      : {}),
  };
}

/**
 * Session-level model pin for the bridge. CLI-style agents use launch flags;
 * ACP-native agents receive the selected model over the protocol. The
 * synthetic "acp-default" id is never forwarded.
 */
function buildAcpModelSelectionParam(
  profile: AcpAgentProfile,
  options: AcpSessionExecutionOptions,
): Record<string, unknown> {
  const model = options.model;
  const listCommand = buildAcpModelListCommand(profile);
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

export interface BuildAcpSessionParamsArgs {
  additionalWorkspaceWriteRoots: readonly string[];
  cwd: string;
  dynamicTools?: readonly DynamicTool[] | undefined;
  options: AcpSessionExecutionOptions;
  profile: AcpAgentProfile;
  /** Provider label used in user-facing capability errors. */
  providerLabel: string;
  threadId: string;
}

/**
 * The bridge's internal session-construction params
 * (`acpBridgeThreadStartParamsSchema` shape) for a thread start/resume/fork.
 */
export function buildAcpSessionParams(
  args: BuildAcpSessionParamsArgs,
): Record<string, unknown> {
  const { options, profile } = args;
  const instructions = buildAcpSessionInstructions(options);
  const cwd = profile.cwd ?? args.cwd;
  const envVars = {
    ...(profile.env ?? {}),
    ...(options.envVars ?? {}),
  };
  if (options.permissionMode === "auto") {
    throw new Error(
      `Provider "${args.providerLabel}" does not support permission mode "auto".`,
    );
  }
  return {
    threadId: args.threadId,
    cwd,
    agent: {
      command: profile.agentCommand.command,
      args: [...profile.agentCommand.args],
    },
    ...buildAcpModelSelectionParam(profile, options),
    ...(profile.reasoningCli !== undefined
      ? { reasoningCli: profile.reasoningCli }
      : {}),
    ...(profile.nativeReasoning !== undefined
      ? { nativeReasoning: profile.nativeReasoning }
      : {}),
    ...(profile.permissionCli !== undefined
      ? { permissionCli: profile.permissionCli }
      : {}),
    ...(profile.reasoningCli !== undefined &&
    options.reasoningLevel !== undefined
      ? { launchReasoningLevel: options.reasoningLevel }
      : {}),
    permissionMode: options.permissionMode,
    permissionEscalation: options.permissionEscalation,
    workspaceWriteRoots: [cwd, ...args.additionalWorkspaceWriteRoots],
    ...(Object.keys(envVars).length > 0 ? { envVars } : {}),
    ...(instructions ? { instructions } : {}),
    ...(args.dynamicTools && args.dynamicTools.length > 0
      ? { dynamicTools: args.dynamicTools }
      : {}),
  };
}
