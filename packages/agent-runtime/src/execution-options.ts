import type { BridgeProtocolAdapter } from "./bridge-protocol-adapter.js";
import type { AgentRuntimeExecutionOptions } from "./types.js";
import type { ProviderExecutionContext } from "./provider-adapter.js";
import type { RuntimePermissionPolicy } from "@bb/domain";

interface AssertProviderSupportsExecutionOptionsArgs {
  adapter: BridgeProtocolAdapter;
  options: AgentRuntimeExecutionOptions;
  providerId: string;
}

interface ToProviderExecutionContextArgs {
  additionalWorkspaceWriteRoots: readonly string[];
  envVars: Record<string, string>;
  execOpts: AgentRuntimeExecutionOptions;
  instructions: string | undefined;
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
}

interface KeepRunningTurnApprovalsArgs {
  requested: AgentRuntimeExecutionOptions;
  running: AgentRuntimeExecutionOptions;
}

export function keepRunningTurnApprovals(
  args: KeepRunningTurnApprovalsArgs,
): AgentRuntimeExecutionOptions {
  if (
    args.requested.permissionEscalation !== "deny" ||
    args.running.permissionEscalation !== "ask"
  ) {
    return args.requested;
  }
  return { ...args.requested, permissionEscalation: "ask" };
}

export function toProviderExecutionContext(
  args: ToProviderExecutionContextArgs,
): ProviderExecutionContext {
  const permissionPolicy: RuntimePermissionPolicy = args.execOpts;
  return {
    model: args.execOpts.model,
    serviceTier: args.execOpts.serviceTier,
    reasoningLevel: args.execOpts.reasoningLevel,
    ...(args.execOpts.promptMode !== undefined
      ? { promptMode: args.execOpts.promptMode }
      : {}),
    ...(args.execOpts.sessionOptions !== undefined
      ? { sessionOptions: args.execOpts.sessionOptions }
      : {}),
    providerOptions: args.execOpts.providerOptions,
    ...permissionPolicy,
    instructions: args.instructions,
    envVars: args.envVars,
    additionalWorkspaceWriteRoots: args.additionalWorkspaceWriteRoots,
  };
}
