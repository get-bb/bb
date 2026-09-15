import {
  findLocalPathProjectSourceForHost,
  type ProjectSource,
} from "@bb/domain";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import {
  PERSONAL_WORKSPACE_ENVIRONMENT_PROVIDER_ID,
  PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
} from "@bb/client-core";
import {
  encodeProviderValue,
  parseEnvironmentValue,
  REUSE_VALUE_WITHOUT_ENVIRONMENT,
} from "@/components/pickers/environment-picker-value";
import type { ReuseThreadOption } from "@/components/pickers/reuse-environment/reuse-options";

interface ResolveRootComposeEffectiveEnvironmentValueArgs {
  environmentSelectionValue: string;
  environmentProviders?: readonly SystemEnvironmentProvider[];
  isProjectless: boolean;
  knownHostIds: ReadonlySet<string>;
  primaryHostId: string | null;
  projectSources: readonly ProjectSource[];
  reuseThreadOptions: readonly ReuseThreadOption[];
  reuseThreadOptionsLoading: boolean;
  hasReuseDiscoveryFailures: boolean;
}

interface ResolveProjectlessEnvironmentValueArgs {
  environmentProviders: readonly SystemEnvironmentProvider[] | undefined;
  environmentSelectionValue: string;
  parsedSelection: ReturnType<typeof parseEnvironmentValue>;
  primaryHostId: string | null;
  reuseThreadOptions: readonly ReuseThreadOption[];
  reuseThreadOptionsLoading: boolean;
}

interface ResolveHostEnvironmentProviderArgs {
  currentProvider: SystemEnvironmentProvider | null;
  providers: readonly SystemEnvironmentProvider[];
}

export function resolveHostEnvironmentProvider({
  currentProvider,
  providers,
}: ResolveHostEnvironmentProviderArgs): SystemEnvironmentProvider | null {
  const candidates = providers.filter(
    (provider) =>
      provider.machineProviderId === null &&
      provider.availability?.status !== "unavailable",
  );
  return (
    candidates.find((provider) => provider.id === currentProvider?.id) ??
    candidates[0] ??
    (currentProvider?.machineProviderId === null ? currentProvider : null)
  );
}

export function resolveProjectlessDefaultEnvironmentProvider(
  providers: readonly SystemEnvironmentProvider[],
): SystemEnvironmentProvider | null {
  return (
    providers.find(
      (provider) =>
        provider.id === PERSONAL_WORKSPACE_ENVIRONMENT_PROVIDER_ID &&
        provider.requires.projectless,
    ) ?? null
  );
}

function resolveProjectlessEnvironmentValue({
  environmentProviders,
  environmentSelectionValue,
  parsedSelection,
  primaryHostId,
  reuseThreadOptions,
  reuseThreadOptionsLoading,
}: ResolveProjectlessEnvironmentValueArgs): string {
  if (
    parsedSelection?.type === "reuse" &&
    parsedSelection.environmentId !== null &&
    (reuseThreadOptionsLoading ||
      reuseThreadOptions.some(
        (option) => option.environmentId === parsedSelection.environmentId,
      ))
  ) {
    return environmentSelectionValue;
  }
  if (environmentProviders === undefined) {
    return "";
  }
  if (
    parsedSelection?.type === "provider" &&
    environmentProviders.some((provider) => {
      if (provider.id !== parsedSelection.environmentProviderId) return false;
      return provider.requires.projectless && primaryHostId !== null;
    })
  ) {
    return environmentSelectionValue;
  }
  const defaultProvider = resolveProjectlessDefaultEnvironmentProvider(
    environmentProviders.filter(
      (provider) => provider.requires.projectless && primaryHostId !== null,
    ),
  );
  return defaultProvider === null
    ? ""
    : encodeProviderValue(defaultProvider.id);
}

export function resolveRootComposeEffectiveEnvironmentValue({
  environmentSelectionValue,
  environmentProviders,
  isProjectless,
  knownHostIds,
  primaryHostId,
  projectSources,
  reuseThreadOptions,
  reuseThreadOptionsLoading,
  hasReuseDiscoveryFailures,
}: ResolveRootComposeEffectiveEnvironmentValueArgs): string {
  const parsedSelection = parseEnvironmentValue(environmentSelectionValue);

  if (isProjectless) {
    return resolveProjectlessEnvironmentValue({
      environmentProviders,
      environmentSelectionValue,
      parsedSelection,
      primaryHostId,
      reuseThreadOptions,
      reuseThreadOptionsLoading,
    });
  }

  if (environmentProviders === undefined) {
    return "";
  }
  const providerRegistered = (environmentProviderId: string): boolean =>
    environmentProviders.some(
      (provider) => provider.id === environmentProviderId,
    );
  const selectedProvider =
    parsedSelection?.type === "provider"
      ? environmentProviders.find(
          (provider) => provider.id === parsedSelection.environmentProviderId,
        )
      : undefined;
  const fallbackValue =
    primaryHostId !== null &&
    knownHostIds.has(primaryHostId) &&
    findLocalPathProjectSourceForHost(projectSources, primaryHostId) !==
      undefined &&
    providerRegistered(PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID)
      ? encodeProviderValue(PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID)
      : "";
  const reuseListed = (): boolean =>
    reuseThreadOptions.some(
      (option) =>
        option.value !== null && option.value === environmentSelectionValue,
    );

  if (parsedSelection?.type === "reuse") {
    if (parsedSelection.environmentId === null) {
      return reuseThreadOptionsLoading ||
        reuseThreadOptions.length > 0 ||
        hasReuseDiscoveryFailures
        ? environmentSelectionValue
        : fallbackValue;
    }
    if (reuseThreadOptionsLoading || reuseListed()) {
      return environmentSelectionValue;
    }
    return REUSE_VALUE_WITHOUT_ENVIRONMENT;
  }

  if (parsedSelection?.type === "worktree-path") {
    if (
      !providerRegistered(PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID) ||
      !knownHostIds.has(parsedSelection.hostId)
    ) {
      return fallbackValue;
    }
    return reuseThreadOptionsLoading || reuseListed()
      ? environmentSelectionValue
      : REUSE_VALUE_WITHOUT_ENVIRONMENT;
  }

  if (
    selectedProvider !== undefined &&
    (selectedProvider.machineProviderId !== null || primaryHostId !== null)
  ) {
    return environmentSelectionValue;
  }

  return fallbackValue;
}
