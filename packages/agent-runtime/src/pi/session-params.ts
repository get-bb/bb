/**
 * Pi session parameter mapping.
 *
 * Shared helpers that build the pi bridge's internal session-construction
 * params. Extracted from the pi adapter so the adapter (legacy dialect) and
 * the bridge's canonical Provider Bridge Protocol handlers share one mapping,
 * the same pattern as `acp/session-params.ts`.
 */

import type { DynamicTool, InstructionMode, ReasoningLevel } from "@bb/domain";
import { z } from "zod";
import { buildShellEnvironmentPolicyConfig } from "../shared/adapter-utils.js";

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
// schema never receives a value it would reject; reconciliation picks the
// closest supported level before this point, so this is a defensive floor.
export function toPiThinkingLevel(
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

export function buildPiConfig(
  threadId: string,
  options?: { envVars?: Record<string, string> | undefined },
): Record<string, unknown> | undefined {
  const config: Record<string, unknown> = {};
  if (threadId) config["shell_environment_policy.set.BB_THREAD_ID"] = threadId;
  const shellEnvironmentConfig = buildShellEnvironmentPolicyConfig(
    options?.envVars,
  );
  if (shellEnvironmentConfig) {
    Object.assign(config, shellEnvironmentConfig);
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

/**
 * The execution-option subset the canonical pi session mapping reads.
 * Structurally satisfied by the canonical wire options
 * (`bridgeExecutionOptionsSchema` output).
 */
export interface PiCanonicalSessionOptions {
  model?: string | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  instructions?: string | undefined;
  envVars?: Record<string, string> | undefined;
}

export interface BuildPiCanonicalSessionParamsArgs {
  threadId: string;
  cwd: string;
  options: PiCanonicalSessionOptions;
  instructionMode: InstructionMode;
  dynamicTools?: readonly DynamicTool[] | undefined;
}

/**
 * The pi bridge's internal session-construction params (the legacy
 * `thread/start` shape) built from canonical Provider Bridge Protocol
 * session params. Canonical sessions carry no per-provider skill roots —
 * skill injection moves to the canonical `skills/configure` payload.
 */
export function buildPiCanonicalSessionParams(
  args: BuildPiCanonicalSessionParamsArgs,
): Record<string, unknown> {
  const instructions = args.options.instructions?.trim();
  const config = buildPiConfig(args.threadId, args.options);
  const reasoningLevel = toPiThinkingLevel(args.options.reasoningLevel);
  return {
    threadId: args.threadId,
    cwd: args.cwd,
    ...(instructions
      ? args.instructionMode === "replace"
        ? { baseInstructions: instructions }
        : { appendSystemPrompt: instructions }
      : {}),
    ...(config ? { config } : {}),
    ...(args.options.model ? { model: args.options.model } : {}),
    ...(reasoningLevel ? { reasoningLevel } : {}),
    ...(args.dynamicTools && args.dynamicTools.length > 0
      ? { dynamicTools: args.dynamicTools }
      : {}),
  };
}
