/**
 * ACP session/model-list parameter mapping: a parsed launch spec plus the
 * canonical execution options in, the bridge's session-construction and
 * model-list params out.
 */

import type {
  DynamicTool,
  PermissionMode,
  ReasoningLevel,
  ServiceTier,
} from "@bb/domain";
import path from "node:path";

import {
  ACP_DEFAULT_MODEL_ID,
  type AcpBridgeNativeReasoning,
  type AcpBridgePermissionCli,
  type AcpBridgeReasoningCli,
} from "./bridge-protocol.js";
import { agentModelFamilyId } from "./bridge/model-catalog.js";
import type { AcpLaunchSpec } from "./launch-spec.js";

/**
 * The execution-option subset the ACP session mapping reads. Structurally
 * satisfied by the canonical wire options (`bridgeExecutionOptionsSchema`
 * output).
 */
export interface AcpSessionExecutionOptions {
  model?: string | undefined;
  serviceTier?: ServiceTier | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  instructions?: string | undefined;
  envVars?: Record<string, string> | undefined;
  permissionMode: PermissionMode;
  skillRoots?: readonly AcpSkillRoot[] | undefined;
}

/**
 * A staged skill root in ACP's native form. ACP agents have no skill-directory
 * concept, so each root's skills are named inline in the session instructions;
 * the bridge maps the canonical `skills/configure` payload onto this.
 */
export interface AcpSkillRoot {
  id: string;
  skillDirectoryRootPath: string;
  skills: readonly { name: string; description: string }[];
}

export interface AcpAgentCommandParam {
  command: string;
  args: string[];
  cwd?: string;
  envVars?: Record<string, string>;
}

/** What the bridge needs to discover an agent's models. */
export interface AcpModelListParams {
  /**
   * Command whose stdout lists one `id - Display Name` line per model. The
   * bridge groups the ids into model families with reasoning-effort variants
   * (see `bridge/model-catalog.ts`), falling back to the synthetic "Agent
   * default" entry when the command fails or lists nothing. Absent when the
   * launch spec has no list command — or when there is no spec at all, as in
   * the packaged-bridge smoke, which still gets a valid synthetic response.
   */
  listCommand?: AcpAgentCommandParam;
  /**
   * ACP-native model discovery command. Used only when `listCommand` is
   * absent: the bridge starts a throwaway session and reads the model select
   * from the `session/new` result's config state.
   */
  agent?: AcpAgentCommandParam;
  /** Family ids served in the CLI catalog's default list. */
  primaryModels: string[];
  /**
   * Model ids to probe first within ACP-native reasoning discovery's fixed
   * deadline. Discovery still returns every advertised model in agent order.
   */
  reasoningProbePriorityModelIds: string[];
  /** Enables separate model, reasoning, and service-tier ACP options. */
  parameterizedModelPicker: boolean;
  reasoningCli?: AcpBridgeReasoningCli;
  nativeReasoning?: AcpBridgeNativeReasoning;
}

/**
 * Session-level model pin. CLI-style agents resolve (model, reasoningLevel,
 * serviceTier) to a raw model id and launch with `<selectFlag> <resolved-id>`.
 * ACP-native agents receive these selections after `session/new`: the model
 * through its config option or legacy `session/set_model`, reasoning through
 * `thought_level`, and service tier through `fast`.
 */
type AcpModelSelection =
  | {
      listCommand: AcpAgentCommandParam;
      selectFlag: string;
      model: string;
      reasoningLevel?: ReasoningLevel;
      serviceTier?: ServiceTier;
    }
  | {
      modelId: string;
      reasoningLevel?: ReasoningLevel;
      serviceTier?: ServiceTier;
    };

/** Everything the bridge needs to construct one ACP agent session. */
export interface AcpSessionParams {
  threadId: string;
  cwd: string;
  agent: { command: string; args: string[] };
  /** The dialect the registering plugin named for this agent, if any. */
  dialectId?: string | undefined;
  modelSelection?: AcpModelSelection;
  /**
   * Launch-time reasoning level for agents that take reasoning as a global CLI
   * flag rather than an ACP `thought_level` config option.
   */
  launchReasoningLevel?: ReasoningLevel;
  reasoningCli?: AcpBridgeReasoningCli;
  nativeReasoning?: AcpBridgeNativeReasoning;
  /** Enables the agent's separate model configuration options. */
  parameterizedModelPicker: boolean;
  /**
   * Launch-time permission flags for agents whose own prompt policy must be
   * selected by CLI args rather than by ACP permission responses.
   */
  permissionCli?: AcpBridgePermissionCli;
  permissionMode: "accept-edits" | "full";
  /** Roots (workspace plus configured extras) where client fs writes are allowed. */
  workspaceWriteRoots: string[];
  envVars?: Record<string, string>;
  /** Server-owned instructions; prepended to the session's first prompt. */
  instructions?: string;
  dynamicTools?: readonly DynamicTool[];
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
  skillRoots: readonly AcpSkillRoot[] | undefined,
): string | undefined {
  if (!skillRoots || skillRoots.length === 0) {
    return undefined;
  }

  const skillLines = skillRoots.flatMap((skillRoot) => {
    return skillRoot.skills.map((skill) => {
      const skillFilePath = path.join(
        skillRoot.skillDirectoryRootPath,
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

/** The spec's `env` is always a record; an empty one adds no envVars key. */
function launchEnvVars(launchSpec: AcpLaunchSpec): {
  envVars?: Record<string, string>;
} {
  return Object.keys(launchSpec.env).length > 0
    ? { envVars: launchSpec.env }
    : {};
}

function buildAcpModelListCommand(
  launchSpec: AcpLaunchSpec,
): AcpAgentCommandParam | undefined {
  if (!launchSpec.modelCli || launchSpec.modelCli.listArgs.length === 0) {
    return undefined;
  }
  return {
    command: launchSpec.command,
    args: [...launchSpec.modelCli.listArgs],
    ...(launchSpec.cwd !== undefined ? { cwd: launchSpec.cwd } : {}),
    ...launchEnvVars(launchSpec),
  };
}

function buildAcpModelDiscoveryAgentCommand(
  launchSpec: AcpLaunchSpec,
): AcpAgentCommandParam | undefined {
  if (buildAcpModelListCommand(launchSpec) !== undefined) {
    return undefined;
  }
  return {
    command: launchSpec.command,
    args: [...launchSpec.args],
    ...(launchSpec.cwd !== undefined ? { cwd: launchSpec.cwd } : {}),
    ...launchEnvVars(launchSpec),
  };
}

interface AcpModelListOptions {
  parameterizedModelPicker: boolean;
  primaryModels?: readonly string[];
  reasoningProbePriorityModelIds: readonly string[];
}

/**
 * Model-discovery params derived from the launch spec. A null spec means the
 * request carried none; the bridge then serves its synthetic default entry
 * rather than failing the picker.
 */
export function buildAcpModelListParams(
  launchSpec: AcpLaunchSpec | null,
  options: AcpModelListOptions,
): AcpModelListParams {
  const primaryModels = [
    ...(options.primaryModels ?? launchSpec?.modelCli?.primaryModels ?? []),
  ];
  const reasoningProbePriorityModelIds = [
    ...options.reasoningProbePriorityModelIds,
  ];
  if (launchSpec === null) {
    return {
      primaryModels,
      reasoningProbePriorityModelIds,
      parameterizedModelPicker: options.parameterizedModelPicker,
    };
  }
  const listCommand = buildAcpModelListCommand(launchSpec);
  const agent = buildAcpModelDiscoveryAgentCommand(launchSpec);
  return {
    ...(listCommand !== undefined ? { listCommand } : {}),
    ...(agent !== undefined ? { agent } : {}),
    primaryModels,
    reasoningProbePriorityModelIds,
    parameterizedModelPicker: options.parameterizedModelPicker,
    ...(launchSpec.reasoningCli !== undefined
      ? { reasoningCli: launchSpec.reasoningCli }
      : {}),
    ...(launchSpec.nativeReasoning !== undefined
      ? { nativeReasoning: launchSpec.nativeReasoning }
      : {}),
  };
}

function cursorParameterizedModelId(model: string): string {
  const familyId = model === "auto" ? "default" : agentModelFamilyId(model);
  return familyId.startsWith("cursor-")
    ? familyId.slice("cursor-".length)
    : familyId;
}

/** The synthetic "acp-default" id is never forwarded. */
function buildAcpModelSelectionParam(
  launchSpec: AcpLaunchSpec,
  options: AcpSessionExecutionOptions,
  parameterizedModelPicker: boolean,
  dialectId: string | undefined,
): { modelSelection?: AcpModelSelection } {
  const model = options.model;
  const listCommand = buildAcpModelListCommand(launchSpec);
  if (!model || model === ACP_DEFAULT_MODEL_ID) {
    return {};
  }
  if (
    parameterizedModelPicker ||
    !listCommand ||
    !launchSpec.modelCli?.selectFlag
  ) {
    return {
      modelSelection: {
        modelId:
          parameterizedModelPicker && dialectId === "cursor"
            ? cursorParameterizedModelId(model)
            : model,
        ...(options.reasoningLevel !== undefined
          ? { reasoningLevel: options.reasoningLevel }
          : {}),
        ...(parameterizedModelPicker && options.serviceTier !== undefined
          ? { serviceTier: options.serviceTier }
          : {}),
      },
    };
  }
  return {
    modelSelection: {
      listCommand,
      selectFlag: launchSpec.modelCli.selectFlag,
      model,
      ...(options.reasoningLevel !== undefined
        ? { reasoningLevel: options.reasoningLevel }
        : {}),
      // Only "fast" changes launch resolution; "default" is the normal id.
      ...(options.serviceTier === "fast"
        ? { serviceTier: options.serviceTier }
        : {}),
    },
  };
}

interface BuildAcpSessionParamsArgs {
  additionalWorkspaceWriteRoots: readonly string[];
  cwd: string;
  /** The dialect the registering plugin named for this agent, if any. */
  dialectId?: string | undefined;
  dynamicTools?: readonly DynamicTool[] | undefined;
  launchSpec: AcpLaunchSpec;
  options: AcpSessionExecutionOptions;
  /** Provider label used in user-facing capability errors. */
  providerLabel: string;
  threadId: string;
  parameterizedModelPicker: boolean;
}

/** The bridge's session-construction params for a thread start/resume/fork. */
export function buildAcpSessionParams(
  args: BuildAcpSessionParamsArgs,
): AcpSessionParams {
  const { options, launchSpec } = args;
  const instructions = buildAcpSessionInstructions(options);
  const cwd = launchSpec.cwd ?? args.cwd;
  const envVars = {
    ...launchSpec.env,
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
      command: launchSpec.command,
      args: [...launchSpec.args],
    },
    ...(args.dialectId === undefined ? {} : { dialectId: args.dialectId }),
    ...buildAcpModelSelectionParam(
      launchSpec,
      options,
      args.parameterizedModelPicker,
      args.dialectId,
    ),
    parameterizedModelPicker: args.parameterizedModelPicker,
    ...(launchSpec.reasoningCli !== undefined
      ? { reasoningCli: launchSpec.reasoningCli }
      : {}),
    ...(launchSpec.nativeReasoning !== undefined
      ? { nativeReasoning: launchSpec.nativeReasoning }
      : {}),
    ...(launchSpec.permissionCli !== undefined
      ? { permissionCli: launchSpec.permissionCli }
      : {}),
    ...(launchSpec.reasoningCli !== undefined &&
    options.reasoningLevel !== undefined
      ? { launchReasoningLevel: options.reasoningLevel }
      : {}),
    permissionMode: options.permissionMode,
    workspaceWriteRoots: [cwd, ...args.additionalWorkspaceWriteRoots],
    ...(Object.keys(envVars).length > 0 ? { envVars } : {}),
    ...(instructions ? { instructions } : {}),
    ...(args.dynamicTools && args.dynamicTools.length > 0
      ? { dynamicTools: args.dynamicTools }
      : {}),
  };
}
