import {
  jsonValueSchema,
  removeCommandMentionsFromPromptInput,
  type DynamicTool,
  type InstructionMode,
  type JsonObject,
  type JsonValue,
  type PromptInput,
  type ReasoningLevel,
  type RuntimePermissionPolicy,
  buildShellEnvOverrides,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import {
  toClaudePermissionMode,
  type ClaudePermissionMode,
} from "./interactive-contract.js";

interface AdditionalWorkspaceWriteRootsParams {
  additionalWorkspaceWriteRoots: string[];
}

interface ClaudeLocalPluginConfig {
  type: "local";
  path: string;
}

interface ClaudeSkillConfigParams {
  plugins: ClaudeLocalPluginConfig[];
}

interface ClaudeCodeConfigParams {
  envVars: Record<string, string>;
}

interface ClaudeDynamicToolParams {
  name: string;
  description: string;
  inputSchema: JsonValue;
}

interface ClaudeSessionParams {
  baseInstructions: string;
  threadId: string;
  cwd: string;
  instructionMode: InstructionMode;
  permissionMode: ClaudePermissionMode;
  approvedPlanPermissionMode: ClaudePermissionMode;
  permissionScope: RuntimePermissionPolicy["permissionScope"];
  permissionEscalation: RuntimePermissionPolicy["permissionEscalation"];
  additionalWorkspaceWriteRoots?: string[];
  plugins?: ClaudeLocalPluginConfig[];
  config?: ClaudeCodeConfigParams;
  model?: string;
  reasoningLevel?: ReasoningLevel;
  workflowsEnabled: boolean;
  memoryEnabled?: boolean;
  providerSubagentsEnabled?: boolean;
  dynamicTools?: ClaudeDynamicToolParams[];
  disallowedTools?: string[];
}

interface ClaudeTurnParams {
  threadId: string;
  providerThreadId: string | null;
  expectedTurnId?: string;
  input: PromptInput[];
  model?: string;
  reasoningLevel?: ReasoningLevel;
  workflowsEnabled?: boolean;
  memoryEnabled?: boolean;
  providerSubagentsEnabled?: boolean;
  permissionEscalation: RuntimePermissionPolicy["permissionEscalation"];
  claudeCodePermissionMode?: "plan";
}

export interface ClaudeCodeSkillRoot {
  id: string;
  localPluginPath: string;
}

function buildAdditionalWorkspaceWriteRootsParams(
  roots: readonly string[],
): AdditionalWorkspaceWriteRootsParams | undefined {
  return roots.length > 0
    ? { additionalWorkspaceWriteRoots: [...roots] }
    : undefined;
}

function buildClaudeSkillConfigParams(
  skillRoots: readonly ClaudeCodeSkillRoot[] | undefined,
): ClaudeSkillConfigParams | undefined {
  if (!skillRoots || skillRoots.length === 0) {
    return undefined;
  }

  return {
    plugins: skillRoots.map((skillRoot): ClaudeLocalPluginConfig => ({
      type: "local",
      path: skillRoot.localPluginPath,
    })),
  };
}

function buildClaudeCodeConfig(
  envVars?: Record<string, string>,
): ClaudeCodeConfigParams | undefined {
  if (!envVars) {
    return undefined;
  }
  const overrides = buildShellEnvOverrides(envVars);
  return Object.keys(overrides).length > 0 ? { envVars: overrides } : undefined;
}

export type ClaudeSessionExecutionOptions = RuntimePermissionPolicy & {
  model?: string | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  instructions?: string | undefined;
  envVars?: Record<string, string> | undefined;
  claudeCodePermissionMode?: "plan" | undefined;
  workflowsEnabled: boolean;
  memoryEnabled?: boolean | undefined;
  providerSubagentsEnabled?: boolean | undefined;
  skillRoots?: readonly ClaudeCodeSkillRoot[] | undefined;
};

function resolveClaudeSessionPermissionMode(
  options: ClaudeSessionExecutionOptions,
): ClaudePermissionMode {
  return options.claudeCodePermissionMode ?? toClaudePermissionMode(options);
}

interface BuildInternalSessionParamsArgs {
  additionalWorkspaceWriteRoots: readonly string[];
  cwd: string;
  disallowedTools?: readonly string[] | undefined;
  dynamicTools?: readonly DynamicTool[] | undefined;
  instructionMode: InstructionMode;
  options: ClaudeSessionExecutionOptions;
  threadId: string;
}

function buildInternalSessionParams(
  args: BuildInternalSessionParamsArgs,
): ClaudeSessionParams {
  const baseInstructions = args.options.instructions ?? "";
  const config = buildClaudeCodeConfig(args.options.envVars);
  const dynamicTools: ClaudeDynamicToolParams[] | undefined =
    args.dynamicTools?.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: jsonValueSchema.parse(t.inputSchema),
    }));
  const permissionPolicy = args.options;
  const additionalWorkspaceWriteRootsParams =
    permissionPolicy.permissionScope === "workspace"
      ? buildAdditionalWorkspaceWriteRootsParams(
          args.additionalWorkspaceWriteRoots,
        )
      : undefined;
  const skillConfig = buildClaudeSkillConfigParams(args.options.skillRoots);
  const params: ClaudeSessionParams = {
    baseInstructions,
    threadId: args.threadId,
    cwd: args.cwd,
    instructionMode: args.instructionMode,
    permissionMode: resolveClaudeSessionPermissionMode(args.options),
    approvedPlanPermissionMode: toClaudePermissionMode(permissionPolicy),
    permissionScope: permissionPolicy.permissionScope,
    permissionEscalation: permissionPolicy.permissionEscalation,
    workflowsEnabled: args.options.workflowsEnabled,
    memoryEnabled: args.options.memoryEnabled,
    providerSubagentsEnabled: args.options.providerSubagentsEnabled,
  };
  if (additionalWorkspaceWriteRootsParams !== undefined) {
    params.additionalWorkspaceWriteRoots =
      additionalWorkspaceWriteRootsParams.additionalWorkspaceWriteRoots;
  }
  if (skillConfig !== undefined) {
    params.plugins = skillConfig.plugins;
  }
  if (config !== undefined) {
    params.config = config;
  }
  if (args.options.model !== undefined && args.options.model.length > 0) {
    params.model = args.options.model;
  }
  if (args.options.reasoningLevel !== undefined) {
    params.reasoningLevel = args.options.reasoningLevel;
  }
  if (dynamicTools !== undefined && dynamicTools.length > 0) {
    params.dynamicTools = dynamicTools;
  }
  if (args.disallowedTools !== undefined && args.disallowedTools.length > 0) {
    params.disallowedTools = [...args.disallowedTools];
  }
  return params;
}

const claudeProviderOptionsSchema = z
  .object({
    claudeCodePermissionMode: z.literal("plan").optional(),
    workflowsEnabled: z.boolean().optional(),
    memoryEnabled: z.boolean().optional(),
    providerSubagentsEnabled: z.boolean().optional(),
    additionalWorkspaceWriteRoots: z.array(z.string()).optional(),
  })
  .passthrough();

type ClaudeCanonicalExecutionOptions = RuntimePermissionPolicy & {
  model?: string | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  instructions?: string | undefined;
  envVars?: Record<string, string> | undefined;
  providerOptions?: JsonObject | undefined;
};

interface BuildClaudeSessionParamsArgs {
  threadId: string;
  cwd: string;
  options: ClaudeCanonicalExecutionOptions;
  instructionMode: InstructionMode;
  dynamicTools?: readonly DynamicTool[] | undefined;
  disallowedTools?: readonly string[] | undefined;
  skillRoots?: readonly ClaudeCodeSkillRoot[] | undefined;
}

export function buildClaudeSessionParams(
  args: BuildClaudeSessionParamsArgs,
): ClaudeSessionParams {
  const providerOptions = claudeProviderOptionsSchema.parse(
    args.options.providerOptions ?? {},
  );
  return buildInternalSessionParams({
    additionalWorkspaceWriteRoots:
      providerOptions.additionalWorkspaceWriteRoots ?? [],
    cwd: args.cwd,
    disallowedTools: args.disallowedTools,
    dynamicTools: args.dynamicTools,
    instructionMode: args.instructionMode,
    threadId: args.threadId,
    options: {
      ...args.options,
      skillRoots: args.skillRoots,
      claudeCodePermissionMode: providerOptions.claudeCodePermissionMode,
      workflowsEnabled: providerOptions.workflowsEnabled ?? false,
      memoryEnabled: providerOptions.memoryEnabled,
      providerSubagentsEnabled: providerOptions.providerSubagentsEnabled,
    },
  });
}

function stripClaudePlanCommandMentions(args: {
  input: readonly PromptInput[];
  claudeCodePermissionMode: "plan" | undefined;
}): PromptInput[] {
  if (args.claudeCodePermissionMode !== "plan") {
    return [...args.input];
  }
  return removeCommandMentionsFromPromptInput(args.input, {
    trigger: "/",
    name: "plan",
  });
}

interface BuildClaudeTurnParamsArgs {
  threadId: string;
  providerThreadId: string | null;
  expectedTurnId?: string | undefined;
  input: readonly PromptInput[];
  options: ClaudeCanonicalExecutionOptions;
}

export function buildClaudeTurnParams(
  args: BuildClaudeTurnParamsArgs,
): ClaudeTurnParams {
  const providerOptions = claudeProviderOptionsSchema.parse(
    args.options.providerOptions ?? {},
  );
  const params: ClaudeTurnParams = {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    input: stripClaudePlanCommandMentions({
      input: args.input,
      claudeCodePermissionMode: providerOptions.claudeCodePermissionMode,
    }),
    workflowsEnabled: providerOptions.workflowsEnabled,
    memoryEnabled: providerOptions.memoryEnabled,
    providerSubagentsEnabled: providerOptions.providerSubagentsEnabled,
    permissionEscalation: args.options.permissionEscalation,
  };
  if (args.expectedTurnId !== undefined) {
    params.expectedTurnId = args.expectedTurnId;
  }
  if (args.options.model !== undefined && args.options.model.length > 0) {
    params.model = args.options.model;
  }
  if (args.options.reasoningLevel !== undefined) {
    params.reasoningLevel = args.options.reasoningLevel;
  }
  if (providerOptions.claudeCodePermissionMode !== undefined) {
    params.claudeCodePermissionMode = providerOptions.claudeCodePermissionMode;
  }
  return params;
}
