import type { BridgeProtocolAdapter } from "./bridge-protocol-adapter.js";
import type {
  ClassifyProviderExecutionSettingsChangeArgs,
  ProviderExecutionSettingsChange,
} from "./provider-adapter.js";
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
}

/**
 * Stable structural equality for the opaque provider-options bag. Key order
 * is not semantic, so two bags with the same entries compare equal however
 * the plugin's hook happened to build them.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(
            (value as Record<string, unknown>)[key],
          )}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sameProviderOptions(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function sameExecutionSettings(args: SameExecutionSettingsArgs): boolean {
  return (
    args.left.model === args.right.model &&
    args.left.serviceTier === args.right.serviceTier &&
    args.left.reasoningLevel === args.right.reasoningLevel &&
    args.left.promptMode === args.right.promptMode &&
    sameProviderOptions(args.left.providerOptions, args.right.providerOptions) &&
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
