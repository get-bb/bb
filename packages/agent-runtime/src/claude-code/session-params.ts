/**
 * Claude Code session parameter mapping.
 *
 * Shared helpers that build the claude-code bridge's internal
 * session-construction params. Extracted from the claude-code adapter so the
 * adapter (legacy dialect) and the bridge's canonical Provider Bridge
 * Protocol handlers share one mapping, the same pattern as
 * `acp/session-params.ts` and `pi/session-params.ts`.
 */

import {
  claudeCodeMockCliTrafficConfigSchema,
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  jsonValueSchema,
} from "@bb/domain";
import type {
  ClaudeCodeMockCliTrafficConfig,
  DynamicTool,
  InstructionMode,
  ReasoningLevel,
  RuntimePermissionPolicy,
} from "@bb/domain";
import { z } from "zod";
import { buildShellEnvironmentPolicyConfig } from "../shared/adapter-utils.js";
import type { AgentRuntimeSkillRoot } from "../types.js";
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

interface ClaudeSkillConfigEntryArgs {
  skillRoot: AgentRuntimeSkillRoot;
}

function buildAdditionalWorkspaceWriteRootsParams(
  roots: readonly string[],
): AdditionalWorkspaceWriteRootsParams | undefined {
  return roots.length > 0
    ? { additionalWorkspaceWriteRoots: [...roots] }
    : undefined;
}

function buildClaudeSkillConfigEntry(
  args: ClaudeSkillConfigEntryArgs,
): ClaudeLocalPluginConfig {
  if (args.skillRoot.providerId !== "claude-code") {
    throw new Error(
      `Claude Code cannot configure ${args.skillRoot.providerId} skill root "${args.skillRoot.id}".`,
    );
  }
  return {
    type: "local",
    path: args.skillRoot.localPluginPath,
  };
}

/**
 * Injected skill roots load as local plugins only. Never pass the SDK `skills`
 * option here: it is a session-wide allowlist, so listing the injected skills
 * would hide and reject every other skill the user has installed (~/.claude,
 * plugins, built-ins). Plugin skills are enabled by CLI defaults.
 */
function buildClaudeSkillConfigParams(
  skillRoots: readonly AgentRuntimeSkillRoot[] | undefined,
): ClaudeSkillConfigParams | undefined {
  if (!skillRoots || skillRoots.length === 0) {
    return undefined;
  }

  return {
    plugins: skillRoots.map((skillRoot) =>
      buildClaudeSkillConfigEntry({ skillRoot }),
    ),
  };
}

function buildClaudeCodeConfig(
  envVars?: Record<string, string>,
): Record<string, unknown> | undefined {
  const config = buildShellEnvironmentPolicyConfig(envVars);
  return config ? { ...config } : undefined;
}

/**
 * The execution-option subset the Claude session mapping reads. Structurally
 * satisfied by the adapter's `ProviderExecutionContext`; the bridge's
 * canonical handlers assemble it from the canonical wire options plus the
 * decoded `providerOptions` bag.
 */
export type ClaudeSessionExecutionOptions = RuntimePermissionPolicy & {
  model?: string | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  instructions?: string | undefined;
  envVars?: Record<string, string> | undefined;
  claudeCodePermissionMode?: "plan" | undefined;
  claudeCodeMockCliTraffic: ClaudeCodeMockCliTrafficConfig;
  workflowsEnabled: boolean;
  memoryEnabled?: boolean | undefined;
  providerSubagentsEnabled?: boolean | undefined;
  skillRoots?: readonly AgentRuntimeSkillRoot[] | undefined;
};

function resolveClaudeSessionPermissionMode(
  options: ClaudeSessionExecutionOptions,
): ClaudePermissionMode {
  return options.claudeCodePermissionMode ?? toClaudePermissionMode(options);
}

export interface BuildClaudeSessionParamsArgs {
  additionalWorkspaceWriteRoots: readonly string[];
  cwd: string;
  disallowedTools?: readonly string[] | undefined;
  dynamicTools?: readonly DynamicTool[] | undefined;
  instructionMode: InstructionMode;
  options: ClaudeSessionExecutionOptions;
  threadId: string;
}

/**
 * The claude-code bridge's internal session-construction params (the legacy
 * `thread/start` shape, minus resume/fork identity fields the callers
 * spread in).
 */
export function buildClaudeSessionParams(
  args: BuildClaudeSessionParamsArgs,
): Record<string, unknown> {
  const baseInstructions = args.options.instructions ?? "";
  const config = buildClaudeCodeConfig(args.options.envVars);
  const dynamicTools = args.dynamicTools?.map((t) => ({
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
  return {
    baseInstructions,
    threadId: args.threadId,
    cwd: args.cwd,
    instructionMode: args.instructionMode,
    claudeCodeMockCliTraffic: args.options.claudeCodeMockCliTraffic,
    permissionMode: resolveClaudeSessionPermissionMode(args.options),
    approvedPlanPermissionMode: toClaudePermissionMode(permissionPolicy),
    permissionScope: permissionPolicy.permissionScope,
    permissionEscalation: permissionPolicy.permissionEscalation,
    ...(additionalWorkspaceWriteRootsParams
      ? additionalWorkspaceWriteRootsParams
      : {}),
    ...(skillConfig ? skillConfig : {}),
    ...(config ? { config } : {}),
    ...(args.options.model ? { model: args.options.model } : {}),
    ...(args.options.reasoningLevel
      ? { reasoningLevel: args.options.reasoningLevel }
      : {}),
    workflowsEnabled: args.options.workflowsEnabled,
    memoryEnabled: args.options.memoryEnabled,
    providerSubagentsEnabled: args.options.providerSubagentsEnabled,
    ...(dynamicTools && dynamicTools.length > 0 ? { dynamicTools } : {}),
    ...(args.disallowedTools && args.disallowedTools.length > 0
      ? { disallowedTools: [...args.disallowedTools] }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Canonical wire options → internal session params
// ---------------------------------------------------------------------------

/**
 * Claude-flavored knobs riding `options.providerOptions` on the canonical
 * wire. The generic bridge-protocol adapter packs every provider-flavored
 * execution-context field there; only this bridge interprets the bag.
 */
const claudeProviderOptionsSchema = z
  .object({
    claudeCodePermissionMode: z.literal("plan").optional(),
    claudeCodeMockCliTraffic: claudeCodeMockCliTrafficConfigSchema.optional(),
    workflowsEnabled: z.boolean().optional(),
    memoryEnabled: z.boolean().optional(),
    providerSubagentsEnabled: z.boolean().optional(),
  })
  .passthrough();

/**
 * The canonical execution-option subset the mapping reads. Structurally
 * satisfied by the canonical wire options (`bridgeExecutionOptionsSchema`
 * output).
 */
export type ClaudeCanonicalExecutionOptions = RuntimePermissionPolicy & {
  model?: string | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  instructions?: string | undefined;
  envVars?: Record<string, string> | undefined;
  providerOptions?: Record<string, unknown> | undefined;
};

export interface BuildClaudeCanonicalSessionParamsArgs {
  threadId: string;
  cwd: string;
  options: ClaudeCanonicalExecutionOptions;
  instructionMode: InstructionMode;
  dynamicTools?: readonly DynamicTool[] | undefined;
  disallowedTools?: readonly string[] | undefined;
}

/**
 * The bridge's internal session-construction params built from canonical
 * Provider Bridge Protocol session params. Canonical sessions carry no
 * per-provider skill roots (the canonical `skills/configure` payload owns
 * skill injection) and no daemon-level additional workspace write roots.
 * A missing providerOptions bag falls back to the provider defaults
 * (workflows off, mock CLI traffic disabled).
 */
export function buildClaudeCanonicalSessionParams(
  args: BuildClaudeCanonicalSessionParamsArgs,
): Record<string, unknown> {
  const providerOptions = claudeProviderOptionsSchema.parse(
    args.options.providerOptions ?? {},
  );
  return buildClaudeSessionParams({
    additionalWorkspaceWriteRoots: [],
    cwd: args.cwd,
    disallowedTools: args.disallowedTools,
    dynamicTools: args.dynamicTools,
    instructionMode: args.instructionMode,
    threadId: args.threadId,
    // Spread preserves the correlated permission-policy union; the decoded
    // provider-flavored knobs override their canonical-wire placement.
    options: {
      ...args.options,
      claudeCodePermissionMode: providerOptions.claudeCodePermissionMode,
      claudeCodeMockCliTraffic:
        providerOptions.claudeCodeMockCliTraffic ??
        DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
      workflowsEnabled: providerOptions.workflowsEnabled ?? false,
      memoryEnabled: providerOptions.memoryEnabled,
      providerSubagentsEnabled: providerOptions.providerSubagentsEnabled,
    },
  });
}

export interface BuildClaudeCanonicalTurnParamsArgs {
  threadId: string;
  providerThreadId: string | null;
  expectedTurnId?: string | undefined;
  input: readonly unknown[];
  options: ClaudeCanonicalExecutionOptions;
}

/**
 * The bridge's internal turn params (legacy `turn/start`/`turn/steer` shape)
 * built from canonical turn params. Live-setting knobs stay undefined when
 * the providerOptions bag omits them, which the bridge's per-turn settings
 * reconciliation reads as "keep the session's current value" — the same
 * machinery both dialects feed.
 */
export function buildClaudeCanonicalTurnParams(
  args: BuildClaudeCanonicalTurnParamsArgs,
): Record<string, unknown> {
  const providerOptions = claudeProviderOptionsSchema.parse(
    args.options.providerOptions ?? {},
  );
  return {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    ...(args.expectedTurnId !== undefined
      ? { expectedTurnId: args.expectedTurnId }
      : {}),
    input: [...args.input],
    ...(args.options.model ? { model: args.options.model } : {}),
    ...(args.options.reasoningLevel
      ? { reasoningLevel: args.options.reasoningLevel }
      : {}),
    workflowsEnabled: providerOptions.workflowsEnabled,
    memoryEnabled: providerOptions.memoryEnabled,
    providerSubagentsEnabled: providerOptions.providerSubagentsEnabled,
    permissionEscalation: args.options.permissionEscalation,
  };
}
