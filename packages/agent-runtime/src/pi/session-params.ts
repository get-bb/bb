/**
 * Pi session parameter mapping: canonical Provider Bridge Protocol session
 * params in, the pi bridge's session-construction params out.
 */

import type { DynamicTool, InstructionMode, ReasoningLevel } from "@bb/domain";
import { z } from "zod";
import { buildShellEnvOverrides } from "@bb/provider-bridge-protocol/bridge-kit";

export const piReasoningLevelValues = [
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export const piReasoningLevelSchema = z.enum(piReasoningLevelValues);
export type PiReasoningLevel = z.infer<typeof piReasoningLevelSchema>;

// BB's reasoning ladder is a superset of Pi's thinking levels. The only name
// that differs is BB's "none" (no extended thinking), which Pi calls "off".
// Levels Pi does not support ("ultracode", "ultra") are dropped so the bridge
// never receives a value it would reject; reconciliation picks the closest
// supported level before this point, so this is a defensive floor.
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

/**
 * The execution-option subset the pi session mapping reads. Structurally
 * satisfied by the canonical wire options (`bridgeExecutionOptionsSchema`
 * output).
 */
export interface PiSessionOptions {
  model?: string | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  instructions?: string | undefined;
  envVars?: Record<string, string> | undefined;
}

export interface BuildPiSessionParamsArgs {
  threadId: string;
  cwd: string;
  options: PiSessionOptions;
  instructionMode: InstructionMode;
  dynamicTools?: readonly DynamicTool[] | undefined;
  /**
   * Skill directories latched by the canonical `skills/configure` request.
   * Session params never carry them: the process-scoped catalog is configured
   * once and applies to every session the bridge builds afterwards.
   */
  additionalSkillPaths?: readonly string[] | undefined;
}

/** Everything the bridge needs to construct one Pi SDK session. */
export interface PiSessionParams {
  additionalSkillPaths?: readonly string[];
  appendSystemPrompt?: string;
  baseInstructions?: string;
  cwd: string;
  dynamicTools?: readonly DynamicTool[];
  model?: string;
  /** Always carries BB_THREAD_ID; pi applies it as its shell env policy. */
  shellEnvOverrides: Record<string, string>;
  thinkingLevel?: PiReasoningLevel;
}

export function buildPiSessionParams(
  args: BuildPiSessionParamsArgs,
): PiSessionParams {
  const instructions = args.options.instructions?.trim();
  const thinkingLevel = toPiThinkingLevel(args.options.reasoningLevel);
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
    ...(args.dynamicTools && args.dynamicTools.length > 0
      ? { dynamicTools: args.dynamicTools }
      : {}),
    ...(args.additionalSkillPaths && args.additionalSkillPaths.length > 0
      ? { additionalSkillPaths: [...args.additionalSkillPaths] }
      : {}),
  };
}
