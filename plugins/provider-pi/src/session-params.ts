import {
  buildShellEnvOverrides,
  type DynamicTool,
  type InstructionMode,
  type ReasoningLevel,
  type ServiceTier,
} from "@get-bb/plugin-sdk/provider-bridge";

export const PI_LONG_CACHE_SERVICE_TIER = "long-cache";

export type PiCacheRetention = "long";

function toPiCacheRetention(
  serviceTier: ServiceTier | undefined,
): PiCacheRetention | undefined {
  return serviceTier === PI_LONG_CACHE_SERVICE_TIER ? "long" : undefined;
}

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
    default:
      return undefined;
  }
}

interface PiSessionOptions {
  model?: string | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  serviceTier?: ServiceTier | undefined;
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
  cacheRetention?: PiCacheRetention;
  cwd: string;
  dynamicTools?: readonly DynamicTool[];
  model?: string;
  shellEnvOverrides: Record<string, string>;
  thinkingLevel?: PiReasoningLevel;
}

export interface PiTurnOptions {
  model: string | undefined;
  thinkingLevel: PiReasoningLevel | undefined;
  cacheRetention: PiCacheRetention | undefined;
}

export function buildPiTurnOptions(options: PiSessionOptions): PiTurnOptions {
  return {
    model: options.model ? options.model : undefined,
    thinkingLevel: toPiThinkingLevel(options.reasoningLevel),
    cacheRetention: toPiCacheRetention(options.serviceTier),
  };
}

export function buildPiSessionParams(
  args: BuildPiSessionParamsArgs,
): PiSessionParams {
  const instructions = args.options.instructions?.trim();
  const thinkingLevel = toPiThinkingLevel(args.options.reasoningLevel);
  const cacheRetention = toPiCacheRetention(args.options.serviceTier);
  return {
    cwd: args.cwd,
    shellEnvOverrides: {
      BB_THREAD_ID: args.threadId,
      ...buildShellEnvOverrides(args.options.envVars),
    },
    ...(instructions
      ? args.instructionMode === "replace"
        ? { baseInstructions: instructions }
        : { appendSystemPrompt: instructions }
      : {}),
    ...(args.options.model ? { model: args.options.model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(cacheRetention ? { cacheRetention } : {}),
    ...(args.dynamicTools && args.dynamicTools.length > 0
      ? { dynamicTools: args.dynamicTools }
      : {}),
    ...(args.additionalSkillPaths && args.additionalSkillPaths.length > 0
      ? { additionalSkillPaths: [...args.additionalSkillPaths] }
      : {}),
  };
}
