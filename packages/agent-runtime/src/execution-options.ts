import type { ProviderAdapter } from "./provider-adapter.js";
import type {
  ClassifyProviderExecutionSettingsChangeArgs,
  ProviderExecutionSettingsChange,
} from "./provider-adapter.js";
import type {
  AgentRuntimeExecutionOptions,
  AgentRuntimeSkillRoot,
} from "./types.js";
import type { ProviderExecutionContext } from "./provider-adapter.js";
import {
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  type RuntimePermissionPolicy,
} from "@bb/domain";

interface AssertProviderSupportsExecutionOptionsArgs {
  adapter: ProviderAdapter;
  options: AgentRuntimeExecutionOptions;
  providerId: string;
}

interface ToProviderExecutionContextArgs {
  envVars: Record<string, string>;
  execOpts: AgentRuntimeExecutionOptions;
  instructions: string | undefined;
  skillRoots?: readonly AgentRuntimeSkillRoot[];
}

interface SameExecutionSettingsArgs {
  left: AgentRuntimeExecutionOptions;
  right: AgentRuntimeExecutionOptions;
}

export function assertProviderSupportsExecutionOptions(
  args: AssertProviderSupportsExecutionOptionsArgs,
): void {
  if (
    args.options.serviceTier !== undefined &&
    args.options.serviceTier !== "default" &&
    !args.adapter.capabilities.supportsServiceTier
  ) {
    throw new Error(
      `Provider "${args.providerId}" does not support service tiers.`,
    );
  }

  if (
    !args.adapter.capabilities.permissionModes.includes(
      args.options.permissionMode,
    )
  ) {
    throw new Error(
      `Provider "${args.providerId}" does not support permission mode "${args.options.permissionMode}".`,
    );
  }

  if (
    args.options.claudeCodePermissionMode !== undefined &&
    args.providerId !== "claude-code"
  ) {
    throw new Error(
      `Provider "${args.providerId}" does not support Claude Code permission mode overrides.`,
    );
  }
}

export function sameExecutionSettings(
  args: SameExecutionSettingsArgs,
): boolean {
  const leftMockCliTraffic =
    args.left.claudeCodeMockCliTraffic ??
    DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG;
  const rightMockCliTraffic =
    args.right.claudeCodeMockCliTraffic ??
    DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG;
  return (
    args.left.model === args.right.model &&
    args.left.serviceTier === args.right.serviceTier &&
    args.left.reasoningLevel === args.right.reasoningLevel &&
    args.left.workflowsEnabled === args.right.workflowsEnabled &&
    args.left.memoryEnabled === args.right.memoryEnabled &&
    args.left.providerSubagentsEnabled ===
      args.right.providerSubagentsEnabled &&
    args.left.claudeCodePermissionMode ===
      args.right.claudeCodePermissionMode &&
    leftMockCliTraffic.enabled === rightMockCliTraffic.enabled &&
    leftMockCliTraffic.endpoint === rightMockCliTraffic.endpoint &&
    args.left.permissionMode === args.right.permissionMode &&
    args.left.permissionScope === args.right.permissionScope &&
    args.left.approvalReviewer === args.right.approvalReviewer &&
    args.left.permissionEscalation === args.right.permissionEscalation
  );
}

export function classifySessionExecutionSettingsChange(
  args: ClassifyProviderExecutionSettingsChangeArgs,
): ProviderExecutionSettingsChange {
  return sameExecutionSettings({ left: args.current, right: args.next })
    ? "unchanged"
    : "session";
}

function sameClaudeSessionSettings(
  args: ClassifyProviderExecutionSettingsChangeArgs,
): boolean {
  const currentMockCliTraffic =
    args.current.claudeCodeMockCliTraffic ??
    DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG;
  const nextMockCliTraffic =
    args.next.claudeCodeMockCliTraffic ??
    DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG;
  return (
    args.current.claudeCodePermissionMode ===
      args.next.claudeCodePermissionMode &&
    currentMockCliTraffic.enabled === nextMockCliTraffic.enabled &&
    currentMockCliTraffic.endpoint === nextMockCliTraffic.endpoint &&
    args.current.permissionMode === args.next.permissionMode &&
    args.current.permissionScope === args.next.permissionScope &&
    args.current.approvalReviewer === args.next.approvalReviewer
  );
}

function sameClaudeLiveSettings(
  args: ClassifyProviderExecutionSettingsChangeArgs,
): boolean {
  return (
    args.current.model === args.next.model &&
    args.current.reasoningLevel === args.next.reasoningLevel &&
    args.current.workflowsEnabled === args.next.workflowsEnabled &&
    (args.current.memoryEnabled ?? true) ===
      (args.next.memoryEnabled ?? true) &&
    (args.current.providerSubagentsEnabled ?? true) ===
      (args.next.providerSubagentsEnabled ?? true) &&
    args.current.permissionEscalation === args.next.permissionEscalation
  );
}

export function classifyClaudeExecutionSettingsChange(
  args: ClassifyProviderExecutionSettingsChangeArgs,
): ProviderExecutionSettingsChange {
  if (!sameClaudeSessionSettings(args)) {
    return "session";
  }
  return sameClaudeLiveSettings(args) ? "unchanged" : "live";
}

export function normalizeClaudeExecutionOptions(
  options: AgentRuntimeExecutionOptions,
): AgentRuntimeExecutionOptions {
  if (options.serviceTier !== "fast") {
    return options;
  }
  return { ...options, serviceTier: "default" };
}

export function toProviderExecutionContext(
  args: ToProviderExecutionContextArgs,
): ProviderExecutionContext {
  const permissionPolicy: RuntimePermissionPolicy = args.execOpts;
  return {
    model: args.execOpts.model,
    serviceTier: args.execOpts.serviceTier,
    reasoningLevel: args.execOpts.reasoningLevel,
    ...(args.execOpts.claudeCodePermissionMode !== undefined
      ? { claudeCodePermissionMode: args.execOpts.claudeCodePermissionMode }
      : {}),
    claudeCodeMockCliTraffic:
      args.execOpts.claudeCodeMockCliTraffic ??
      DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
    workflowsEnabled: args.execOpts.workflowsEnabled,
    memoryEnabled: args.execOpts.memoryEnabled,
    providerSubagentsEnabled: args.execOpts.providerSubagentsEnabled,
    ...permissionPolicy,
    instructions: args.instructions,
    envVars: args.envVars,
    ...(args.skillRoots && args.skillRoots.length > 0
      ? { skillRoots: args.skillRoots }
      : {}),
  };
}
