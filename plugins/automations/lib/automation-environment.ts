import type { JsonValue } from "@get-bb/plugin-sdk";
import type {
  AgentEnvironment,
  ProviderEnvironment,
} from "../src/rpc-types";

export interface EnvironmentCatalogProvider {
  id: string;
  displayName: string;
  icon: string | null;
  logoUrl: string | null;
  machineProviderId: string | null;
}

export interface EnvironmentCatalogMachine {
  id: string;
  name: string;
}

export interface EnvironmentCatalog {
  providers: readonly EnvironmentCatalogProvider[];
  machines: readonly EnvironmentCatalogMachine[];
}

export interface ProviderEnvironmentSummary {
  label: string;
  compactLabel: string;
  providerId: string;
  provider: EnvironmentCatalogProvider | null;
  hostId: string | null;
  problem: string | null;
}

export const GIT_WORKTREE_PROVIDER_ID = "git-worktree";
export const PROJECT_CHECKOUT_PROVIDER_ID = "project-checkout";
export const PERSONAL_WORKSPACE_PROVIDER_ID = "personal-workspace";

const FALLBACK_PROVIDER_NAMES: Record<string, string> = {
  [GIT_WORKTREE_PROVIDER_ID]: "Worktree",
  [PROJECT_CHECKOUT_PROVIDER_ID]: "Project checkout",
  [PERSONAL_WORKSPACE_PROVIDER_ID]: "Personal workspace",
};

function isJsonObject(
  value: JsonValue | null | undefined,
): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function environmentInputsBranchLabel(
  inputs: JsonValue | null,
): string | null {
  if (!isJsonObject(inputs)) return null;
  const branch = inputs.branch;
  if (!isJsonObject(branch)) return null;
  if (branch.kind === "named" && typeof branch.name === "string") {
    return `from ${branch.name}`;
  }
  if (branch.kind === "new" && typeof branch.baseBranch === "string") {
    return `from ${branch.baseBranch}`;
  }
  if (branch.kind === "existing" && typeof branch.name === "string") {
    return `on ${branch.name}`;
  }
  return null;
}

export function projectCheckoutPath(
  environment: ProviderEnvironment,
): string | null {
  if (environment.environmentProviderId !== PROJECT_CHECKOUT_PROVIDER_ID) {
    return null;
  }
  const inputs = environment.inputs;
  return isJsonObject(inputs) &&
    typeof inputs.path === "string" &&
    inputs.path.length > 0
    ? inputs.path
    : null;
}

export function hostEnvironmentAsProvider(
  environment: Extract<AgentEnvironment, { type: "host" }>,
): ProviderEnvironment {
  const machine =
    environment.hostId === undefined
      ? {}
      : { machine: { type: "existing" as const, hostId: environment.hostId } };
  switch (environment.workspace.type) {
    case "managed-worktree":
      return {
        type: "provider",
        environmentProviderId: GIT_WORKTREE_PROVIDER_ID,
        ...machine,
        inputs: { branch: environment.workspace.baseBranch },
      };
    case "personal":
      return {
        type: "provider",
        environmentProviderId: PERSONAL_WORKSPACE_PROVIDER_ID,
        ...machine,
        inputs: null,
      };
    case "unmanaged":
      return {
        type: "provider",
        environmentProviderId: PROJECT_CHECKOUT_PROVIDER_ID,
        ...machine,
        inputs:
          environment.workspace.branch === undefined
            ? {}
            : { branch: environment.workspace.branch },
      };
  }
}

export function summarizeProviderEnvironment(
  environment: ProviderEnvironment,
  catalog: EnvironmentCatalog | null,
): ProviderEnvironmentSummary {
  const providerId = environment.environmentProviderId;
  const provider =
    catalog?.providers.find((entry) => entry.id === providerId) ?? null;
  const providerName =
    provider?.displayName ?? FALLBACK_PROVIDER_NAMES[providerId] ?? providerId;
  const machine = environment.machine;
  const hostId = machine?.type === "existing" ? machine.hostId : null;
  const machineName =
    hostId === null
      ? null
      : (catalog?.machines.find((entry) => entry.id === hostId)?.name ?? null);
  const placement =
    machine?.type === "new" && provider?.machineProviderId == null
      ? `${providerName} on a new machine`
      : machineName === null
        ? providerName
        : `${providerName} on ${machineName}`;
  const branch = environmentInputsBranchLabel(environment.inputs);
  return {
    label: branch === null ? placement : `${placement} · ${branch}`,
    compactLabel: providerName,
    providerId,
    provider,
    hostId,
    problem: providerEnvironmentProblem({
      catalog,
      provider,
      providerId,
      hostId,
      machineName,
    }),
  };
}

function providerEnvironmentProblem({
  catalog,
  provider,
  providerId,
  hostId,
  machineName,
}: {
  catalog: EnvironmentCatalog | null;
  provider: EnvironmentCatalogProvider | null;
  providerId: string;
  hostId: string | null;
  machineName: string | null;
}): string | null {
  if (catalog === null) return null;
  if (provider === null) {
    return `the ${providerId} environment provider is not installed`;
  }
  if (hostId !== null && machineName === null && catalog.machines.length > 0) {
    return "its machine no longer exists";
  }
  return null;
}
