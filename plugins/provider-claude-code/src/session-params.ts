/**
 * Claude Code session parameter mapping: canonical Provider Bridge Protocol
 * session and turn params in, the bridge's internal session-construction and
 * turn params out.
 */

import {
  jsonValueSchema,
  removeCommandMentionsFromPromptInput,
  type DynamicTool,
  type InstructionMode,
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

/**
 * A staged skill root in Claude's native form. The canonical
 * `skills/configure` payload is mapped onto this by the bridge; Claude loads
 * each one as a local plugin.
 */
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

/**
 * Injected skill roots load as local plugins only. Never pass the SDK `skills`
 * option here: it is a session-wide allowlist, so listing the injected skills
 * would hide and reject every other skill the user has installed (~/.claude,
 * plugins, built-ins). Plugin skills are enabled by CLI defaults.
 */
function buildClaudeSkillConfigParams(
  skillRoots: readonly ClaudeCodeSkillRoot[] | undefined,
): ClaudeSkillConfigParams | undefined {
  if (!skillRoots || skillRoots.length === 0) {
    return undefined;
  }

  return {
    plugins: skillRoots.map(
      (skillRoot): ClaudeLocalPluginConfig => ({
        type: "local",
        path: skillRoot.localPluginPath,
      }),
    ),
  };
}

/**
 * The session config bag is claude-code-internal (this module encodes it, the
 * bridge decodes it), so env overrides travel as a plain map under the
 * bridge's own `envVars` key — filtered through the shared name-safety guard.
 */
function buildClaudeCodeConfig(
  envVars?: Record<string, string>,
): Record<string, unknown> | undefined {
  if (!envVars) {
    return undefined;
  }
  const overrides = buildShellEnvOverrides(envVars);
  return Object.keys(overrides).length > 0 ? { envVars: overrides } : undefined;
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

/**
 * The bridge's session-construction params, minus the resume/fork identity
 * fields the callers spread in.
 */
function buildInternalSessionParams(
  args: BuildInternalSessionParamsArgs,
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
// Wire options → internal session params
// ---------------------------------------------------------------------------

/**
 * Claude-flavored knobs riding `options.providerOptions` on the canonical
 * wire. The generic bridge-protocol adapter packs every provider-flavored
 * execution-context field there; only this bridge interprets the bag.
 */
const claudeProviderOptionsSchema = z
  .object({
    claudeCodePermissionMode: z.literal("plan").optional(),
    workflowsEnabled: z.boolean().optional(),
    memoryEnabled: z.boolean().optional(),
    providerSubagentsEnabled: z.boolean().optional(),
    /**
     * Environment-level extra write roots. Rides the opaque provider-options
     * bag (packed by the registry) because the canonical wire has no core
     * field for it — same delivery as the ACP launch spec.
     */
    additionalWorkspaceWriteRoots: z.array(z.string()).optional(),
  })
  .passthrough();

/**
 * The canonical execution-option subset the mapping reads. Structurally
 * satisfied by the canonical wire options (`bridgeExecutionOptionsSchema`
 * output).
 */
type ClaudeCanonicalExecutionOptions = RuntimePermissionPolicy & {
  model?: string | undefined;
  reasoningLevel?: ReasoningLevel | undefined;
  instructions?: string | undefined;
  envVars?: Record<string, string> | undefined;
  providerOptions?: Record<string, unknown> | undefined;
};

interface BuildClaudeSessionParamsArgs {
  threadId: string;
  cwd: string;
  options: ClaudeCanonicalExecutionOptions;
  instructionMode: InstructionMode;
  dynamicTools?: readonly DynamicTool[] | undefined;
  disallowedTools?: readonly string[] | undefined;
  /**
   * Skill roots latched by the canonical `skills/configure` request. Session
   * params never carry them: the process-scoped catalog is configured once and
   * applies to every session the bridge builds afterwards.
   */
  skillRoots?: readonly ClaudeCodeSkillRoot[] | undefined;
}

/**
 * The bridge's session-construction params, built from the canonical Provider
 * Bridge Protocol session params. Skill roots come from the process-scoped
 * `skills/configure` latch rather than the session options; the daemon's extra
 * workspace write roots ride the providerOptions bag. A missing providerOptions
 * bag falls back to the provider defaults (workflows off, mock CLI traffic
 * disabled).
 */
export function buildClaudeSessionParams(
  args: BuildClaudeSessionParamsArgs,
): Record<string, unknown> {
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
    // Spread preserves the correlated permission-policy union; the decoded
    // provider-flavored knobs override their canonical-wire placement.
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

/**
 * Plan mode is delivered as a session option, not as prompt text: the Claude
 * CLI would treat a literal `/plan` in the prompt as a second, redundant
 * command, so the mention that opened plan mode is stripped before the input
 * reaches the SDK.
 */
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

/**
 * The bridge's internal turn params, built from the canonical turn params.
 * Live-setting knobs stay undefined when the providerOptions bag omits them,
 * which the bridge's per-turn settings reconciliation reads as "keep the
 * session's current value".
 */
export function buildClaudeTurnParams(
  args: BuildClaudeTurnParamsArgs,
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
    input: stripClaudePlanCommandMentions({
      input: args.input,
      claudeCodePermissionMode: providerOptions.claudeCodePermissionMode,
    }),
    ...(args.options.model ? { model: args.options.model } : {}),
    ...(args.options.reasoningLevel
      ? { reasoningLevel: args.options.reasoningLevel }
      : {}),
    workflowsEnabled: providerOptions.workflowsEnabled,
    memoryEnabled: providerOptions.memoryEnabled,
    providerSubagentsEnabled: providerOptions.providerSubagentsEnabled,
    permissionEscalation: args.options.permissionEscalation,
    ...(providerOptions.claudeCodePermissionMode !== undefined
      ? { claudeCodePermissionMode: providerOptions.claudeCodePermissionMode }
      : {}),
  };
}
