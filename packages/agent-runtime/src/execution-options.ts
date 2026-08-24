import type { BridgeProtocolAdapter } from "./bridge-protocol-adapter.js";
import type {
  AgentRuntimeExecutionOptions,
  AgentRuntimeSkillRoot,
} from "./types.js";
import type { ProviderExecutionContext } from "./provider-adapter.js";
import type { RuntimePermissionPolicy } from "@bb/domain";

interface AssertProviderSupportsExecutionOptionsArgs {
  adapter: BridgeProtocolAdapter;
  options: AgentRuntimeExecutionOptions;
  providerId: string;
}

interface ToProviderExecutionContextArgs {
  envVars: Record<string, string>;
  execOpts: AgentRuntimeExecutionOptions;
  instructions: string | undefined;
  skillRoots?: readonly AgentRuntimeSkillRoot[];
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
    providerOptions: args.execOpts.providerOptions,
    ...permissionPolicy,
    instructions: args.instructions,
    envVars: args.envVars,
    ...(args.skillRoots && args.skillRoots.length > 0
      ? { skillRoots: args.skillRoots }
      : {}),
  };
}
