import type { PluginEnvironmentProvider } from "@get-bb/plugin-sdk/app";
import type { IconName } from "@/components/ui/icon";

export type EnvironmentWorkspaceDisplayProviderLookup =
  | { status: "loading" }
  | {
      status: "loaded";
      provider: PluginEnvironmentProvider | null;
      environmentProviderId: string | null;
    };

export const UNNAMED_ENVIRONMENT_LABEL = "Environment";

const PERSISTENT_HOST_ICON_NAME: IconName = "Laptop";

export function findEnvironmentDisplayProvider(
  providers: readonly PluginEnvironmentProvider[] | undefined,
  environmentProviderId: string | null,
): EnvironmentWorkspaceDisplayProviderLookup {
  if (environmentProviderId === null) {
    return { status: "loaded", provider: null, environmentProviderId: null };
  }
  if (providers === undefined) {
    return { status: "loading" };
  }
  return {
    status: "loaded",
    environmentProviderId,
    provider:
      providers.find((candidate) => candidate.id === environmentProviderId) ??
      null,
  };
}

interface EnvironmentDisplayNameSource {
  name: string | null;
  branchName: string | null;
  path: string | null;
  environmentProviderId: string | null;
}

function workspaceFolderName(workspacePath: string | null): string | null {
  if (workspacePath === null) return null;
  const segments = workspacePath.split(/[\\/]+/u).filter(Boolean);
  return segments[segments.length - 1] ?? null;
}

function environmentProviderLabel(
  environmentProviderId: string,
  lookup: EnvironmentWorkspaceDisplayProviderLookup,
): string | null {
  if (lookup.status === "loading") return null;
  return lookup.provider === null
    ? environmentProviderId
    : lookup.provider.displayName;
}

export function resolveEnvironmentDisplayName(
  source: EnvironmentDisplayNameSource,
  lookup: EnvironmentWorkspaceDisplayProviderLookup,
): string | null {
  return (
    source.name ??
    source.branchName ??
    (source.environmentProviderId === null
      ? workspaceFolderName(source.path)
      : environmentProviderLabel(source.environmentProviderId, lookup))
  );
}

export function getEnvironmentLabelIconName(
  providerLookup: EnvironmentWorkspaceDisplayProviderLookup,
): IconName {
  const provider =
    providerLookup.status === "loaded" ? providerLookup.provider : null;
  return provider === null
    ? PERSISTENT_HOST_ICON_NAME
    : (provider.icon ?? "Zap");
}
