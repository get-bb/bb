import { PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID } from "@bb/client-core";
import type { EnvironmentMachineSelection, JsonValue } from "@bb/domain";
import type {
  CreateThreadRequest,
  SystemEnvironmentProvider,
} from "@bb/server-contract";
import { parseEnvironmentValue } from "@/components/pickers/environment-picker-value";

interface ResolveRootComposeThreadEnvironmentArgs {
  environmentValue: string;
  projectId: string | undefined;
  environmentProviders?: readonly SystemEnvironmentProvider[];
  providerHostId?: string | null;
  providerMachine?: EnvironmentMachineSelection | null;
  providerInputs?: JsonValue | null;
}

export function resolveRootComposeThreadEnvironment(
  args: ResolveRootComposeThreadEnvironmentArgs,
): CreateThreadRequest["environment"] | null {
  if (!args.projectId) return null;
  const parsed = parseEnvironmentValue(args.environmentValue);
  if (!parsed) return null;

  if (parsed.type === "provider") {
    const provider = args.environmentProviders?.find(
      (candidate) => candidate.id === parsed.environmentProviderId,
    );
    if (provider === undefined) return null;
    const machine =
      args.providerMachine ??
      (args.providerHostId === undefined || args.providerHostId === null
        ? null
        : { type: "existing" as const, hostId: args.providerHostId });
    if (machine === null && !provider.machineProviderId) return null;
    const inputs =
      provider.inputs === null ? null : (args.providerInputs ?? null);
    if (provider.inputs !== null && inputs === null) return null;
    return {
      type: "provider",
      environmentProviderId: provider.id,
      ...(machine === null ? {} : { machine }),
      inputs,
    };
  }

  if (parsed.type === "worktree-path") {
    const checkoutProvider = args.environmentProviders?.find(
      (candidate) => candidate.id === PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
    );
    if (checkoutProvider === undefined) return null;
    return {
      type: "provider",
      environmentProviderId: checkoutProvider.id,
      machine: { type: "existing", hostId: parsed.hostId },
      inputs: { path: parsed.canonicalPath },
    };
  }

  if (parsed.environmentId === null) return null;
  return { type: "reuse", environmentId: parsed.environmentId };
}
