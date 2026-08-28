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

export interface AcpSessionExecutionOptions {
  model?: string | undefined;
  serviceTier?: ServiceTier | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  instructions?: string | undefined;
  envVars?: Record<string, string> | undefined;
  permissionMode: PermissionMode;
  skillRoots?: readonly AcpSkillRoot[] | undefined;
}

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

export interface AcpModelListParams {
  listCommand?: AcpAgentCommandParam;
  agent?: AcpAgentCommandParam;
  primaryModels: string[];
  reasoningProbePriorityModelIds: string[];
  parameterizedModelPicker: boolean;
  reasoningCli?: AcpBridgeReasoningCli;
  nativeReasoning?: AcpBridgeNativeReasoning;
}

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

export interface AcpSessionParams {
  threadId: string;
  cwd: string;
  agent: { command: string; args: string[] };
  dialectId?: string | undefined;
  modelSelection?: AcpModelSelection;
  launchReasoningLevel?: ReasoningLevel;
  reasoningCli?: AcpBridgeReasoningCli;
  nativeReasoning?: AcpBridgeNativeReasoning;
  parameterizedModelPicker: boolean;
  permissionCli?: AcpBridgePermissionCli;
  permissionMode: "accept-edits" | "full";
  workspaceWriteRoots: string[];
  envVars?: Record<string, string>;
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
  const command: AcpAgentCommandParam = {
    command: launchSpec.command,
    args: [...launchSpec.modelCli.listArgs],
  };
  if (launchSpec.cwd !== undefined) {
    command.cwd = launchSpec.cwd;
  }
  const envVars = launchEnvVars(launchSpec).envVars;
  if (envVars !== undefined) {
    command.envVars = envVars;
  }
  return command;
}

function buildAcpModelDiscoveryAgentCommand(
  launchSpec: AcpLaunchSpec,
): AcpAgentCommandParam | undefined {
  if (buildAcpModelListCommand(launchSpec) !== undefined) {
    return undefined;
  }
  const command: AcpAgentCommandParam = {
    command: launchSpec.command,
    args: [...launchSpec.args],
  };
  if (launchSpec.cwd !== undefined) {
    command.cwd = launchSpec.cwd;
  }
  const envVars = launchEnvVars(launchSpec).envVars;
  if (envVars !== undefined) {
    command.envVars = envVars;
  }
  return command;
}

interface AcpModelListOptions {
  parameterizedModelPicker: boolean;
  primaryModels?: readonly string[];
  reasoningProbePriorityModelIds: readonly string[];
}

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
  const params: AcpModelListParams = {
    primaryModels,
    reasoningProbePriorityModelIds,
    parameterizedModelPicker: options.parameterizedModelPicker,
  };
  if (listCommand !== undefined) {
    params.listCommand = listCommand;
  }
  if (agent !== undefined) {
    params.agent = agent;
  }
  if (launchSpec.reasoningCli !== undefined) {
    params.reasoningCli = launchSpec.reasoningCli;
  }
  if (launchSpec.nativeReasoning !== undefined) {
    params.nativeReasoning = launchSpec.nativeReasoning;
  }
  return params;
}

interface CursorParameterizedSelection {
  modelId: string;
  reasoningLevel?: ReasoningLevel;
}

const CURSOR_LEGACY_FAMILY_SELECTIONS = {
  "claude-4-sonnet": { modelId: "claude-sonnet-4" },
  "claude-4.5-opus": { modelId: "claude-opus-4-5" },
  "claude-4.5-sonnet": { modelId: "claude-sonnet-4-5" },
  "claude-4.6-opus": { modelId: "claude-opus-4-6" },
  "claude-4.6-sonnet": { modelId: "claude-sonnet-4-6" },
  "gemini-3.6-flash-minimal": {
    modelId: "gemini-3.6-flash",
    reasoningLevel: "low",
  },
  "gpt-5.1-codex-max": { modelId: "gpt-5.1" },
} satisfies Readonly<Record<string, CursorParameterizedSelection>>;

function isCursorLegacyFamilyId(
  value: string,
): value is keyof typeof CURSOR_LEGACY_FAMILY_SELECTIONS {
  return Object.hasOwn(CURSOR_LEGACY_FAMILY_SELECTIONS, value);
}

function cursorParameterizedSelection(
  model: string,
  reasoningLevel: ReasoningLevel | undefined,
): CursorParameterizedSelection {
  const familyId = model === "auto" ? "default" : agentModelFamilyId(model);
  const bareFamilyId = familyId.startsWith("cursor-")
    ? familyId.slice("cursor-".length)
    : familyId;
  const selection: CursorParameterizedSelection = isCursorLegacyFamilyId(
    bareFamilyId,
  )
    ? CURSOR_LEGACY_FAMILY_SELECTIONS[bareFamilyId]
    : { modelId: bareFamilyId };
  return selection.reasoningLevel !== undefined || reasoningLevel === undefined
    ? selection
    : { ...selection, reasoningLevel };
}

function buildAcpModelSelectionParam(
  launchSpec: AcpLaunchSpec,
  options: AcpSessionExecutionOptions,
  parameterizedModelPicker: boolean,
  dialectId: string | undefined,
) {
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
    let modelSelection: AcpModelSelection;
    if (parameterizedModelPicker && dialectId === "cursor") {
      modelSelection = cursorParameterizedSelection(
        model,
        options.reasoningLevel,
      );
    } else {
      const selection: Extract<AcpModelSelection, { modelId: string }> = {
        modelId: model,
      };
      if (options.reasoningLevel !== undefined) {
        selection.reasoningLevel = options.reasoningLevel;
      }
      modelSelection = selection;
    }
    if (parameterizedModelPicker && options.serviceTier !== undefined) {
      modelSelection.serviceTier = options.serviceTier;
    }
    return {
      modelSelection,
    };
  }
  const modelSelection: Extract<
    AcpModelSelection,
    { listCommand: AcpAgentCommandParam }
  > = {
    listCommand,
    selectFlag: launchSpec.modelCli.selectFlag,
    model,
  };
  if (options.reasoningLevel !== undefined) {
    modelSelection.reasoningLevel = options.reasoningLevel;
  }
  if (options.serviceTier === "fast") {
    modelSelection.serviceTier = options.serviceTier;
  }
  return { modelSelection };
}

interface BuildAcpSessionParamsArgs {
  additionalWorkspaceWriteRoots: readonly string[];
  cwd: string;
  dialectId?: string | undefined;
  dynamicTools?: readonly DynamicTool[] | undefined;
  launchSpec: AcpLaunchSpec;
  options: AcpSessionExecutionOptions;
  providerLabel: string;
  threadId: string;
  parameterizedModelPicker: boolean;
}

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
  const params: AcpSessionParams = {
    threadId: args.threadId,
    cwd,
    agent: {
      command: launchSpec.command,
      args: [...launchSpec.args],
    },
    parameterizedModelPicker: args.parameterizedModelPicker,
    permissionMode: options.permissionMode,
    workspaceWriteRoots: [cwd, ...args.additionalWorkspaceWriteRoots],
  };
  if (args.dialectId !== undefined) {
    params.dialectId = args.dialectId;
  }
  const modelSelection = buildAcpModelSelectionParam(
    launchSpec,
    options,
    args.parameterizedModelPicker,
    args.dialectId,
  ).modelSelection;
  if (modelSelection !== undefined) {
    params.modelSelection = modelSelection;
  }
  if (launchSpec.reasoningCli !== undefined) {
    params.reasoningCli = launchSpec.reasoningCli;
  }
  if (launchSpec.nativeReasoning !== undefined) {
    params.nativeReasoning = launchSpec.nativeReasoning;
  }
  if (launchSpec.permissionCli !== undefined) {
    params.permissionCli = launchSpec.permissionCli;
  }
  if (
    launchSpec.reasoningCli !== undefined &&
    options.reasoningLevel !== undefined
  ) {
    params.launchReasoningLevel = options.reasoningLevel;
  }
  if (Object.keys(envVars).length > 0) {
    params.envVars = envVars;
  }
  if (instructions !== undefined) {
    params.instructions = instructions;
  }
  if (args.dynamicTools !== undefined && args.dynamicTools.length > 0) {
    params.dynamicTools = args.dynamicTools;
  }
  return params;
}
