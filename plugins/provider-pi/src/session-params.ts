import {
  buildShellEnvOverrides,
  type DynamicTool,
  type InstructionMode,
  type ReasoningLevel,
} from "@get-bb/plugin-sdk/provider-bridge";

type PiReasoningLevel = "off" | "low" | "medium" | "high" | "xhigh" | "max";

function toPiThinkingLevel(
  reasoningLevel: ReasoningLevel | undefined,
): PiReasoningLevel | undefined {
  switch (reasoningLevel) {
    case "none":
      return "off";
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return reasoningLevel;
    case "ultracode":
    case "ultra":
    case undefined:
      return undefined;
  }
}

interface PiSessionOptions {
  model?: string | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  instructions?: string | undefined;
  envVars?: Record<string, string> | undefined;
}

interface BuildPiSessionParamsArgs {
  threadId: string;
  cwd: string;
  options: PiSessionOptions;
  instructionMode: InstructionMode;
  dynamicTools?: readonly DynamicTool[] | undefined;
  additionalSkillPaths?: readonly string[] | undefined;
}

export interface PiSessionParams {
  additionalSkillPaths?: readonly string[];
  appendSystemPrompt?: string;
  baseInstructions?: string;
  cwd: string;
  dynamicTools?: readonly DynamicTool[];
  model?: string;
  shellEnvOverrides: Record<string, string>;
  thinkingLevel?: PiReasoningLevel;
}

export interface PiTurnOptions {
  model: string | undefined;
  thinkingLevel: PiReasoningLevel | undefined;
}

export function buildPiTurnOptions(options: PiSessionOptions): PiTurnOptions {
  return {
    model: options.model ? options.model : undefined,
    thinkingLevel: toPiThinkingLevel(options.reasoningLevel),
  };
}

export function buildPiSessionParams(
  args: BuildPiSessionParamsArgs,
): PiSessionParams {
  const instructions = args.options.instructions?.trim();
  const thinkingLevel = toPiThinkingLevel(args.options.reasoningLevel);
  const params: PiSessionParams = {
    cwd: args.cwd,
    shellEnvOverrides: {
      BB_THREAD_ID: args.threadId,
      ...buildShellEnvOverrides(args.options.envVars),
    },
  };
  if (instructions) {
    if (args.instructionMode === "replace")
      params.baseInstructions = instructions;
    else params.appendSystemPrompt = instructions;
  }
  if (args.options.model) params.model = args.options.model;
  if (thinkingLevel) params.thinkingLevel = thinkingLevel;
  if (args.dynamicTools && args.dynamicTools.length > 0) {
    params.dynamicTools = args.dynamicTools;
  }
  if (args.additionalSkillPaths && args.additionalSkillPaths.length > 0) {
    params.additionalSkillPaths = [...args.additionalSkillPaths];
  }
  return params;
}
