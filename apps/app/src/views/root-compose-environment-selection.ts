import {
  findLocalPathProjectSourceForHost,
  type Host,
  type ProjectSource,
  type ThreadListEntry,
} from "@bb/domain";
import type {
  ProjectResponse,
  SystemEnvironmentProvider,
} from "@bb/server-contract";
import {
  PERSONAL_WORKSPACE_ENVIRONMENT_PROVIDER_ID,
  PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
} from "@bb/client-core";
import {
  encodeProviderValue,
  parseEnvironmentValue,
} from "@/components/pickers/environment-picker-value";
import type { ReuseThreadOption } from "@/components/pickers/ReuseEnvironmentPicker";
import { getThreadDisplayTitle } from "@/lib/thread-title";

export type SeededReuseEnvironmentStatus = "pending" | "available" | "missing";

export interface SeededReuseEnvironment {
  environmentId: string;
  status: SeededReuseEnvironmentStatus;
}

interface ResolveRootComposeEffectiveEnvironmentValueArgs {
  environmentSelectionValue: string;
  environmentProviders?: readonly SystemEnvironmentProvider[];
  isProjectless: boolean;
  knownHostIds: ReadonlySet<string>;
  primaryHostId: string | null;
  projectSources: readonly ProjectSource[];
  reuseThreadOptions: readonly ReuseThreadOption[];
  reuseThreadOptionsLoading: boolean;
  seededReuseEnvironment: SeededReuseEnvironment | null;
}

interface ResolveProjectlessEnvironmentValueArgs {
  environmentProviders: readonly SystemEnvironmentProvider[] | undefined;
  environmentSelectionValue: string;
  parsedSelection: ReturnType<typeof parseEnvironmentValue>;
  primaryHostId: string | null;
  reuseThreadOptions: readonly ReuseThreadOption[];
  reuseThreadOptionsLoading: boolean;
  seededReuseEnvironment: SeededReuseEnvironment | null;
}

function reuseSelectionSurvives({
  environmentId,
  reuseThreadOptions,
  reuseThreadOptionsLoading,
  seededReuseEnvironment,
}: {
  environmentId: string;
  reuseThreadOptions: readonly ReuseThreadOption[];
  reuseThreadOptionsLoading: boolean;
  seededReuseEnvironment: SeededReuseEnvironment | null;
}): boolean {
  if (
    reuseThreadOptions.some((option) => option.environmentId === environmentId)
  ) {
    return true;
  }
  if (reuseThreadOptionsLoading) return true;
  if (seededReuseEnvironment?.environmentId === environmentId) {
    return seededReuseEnvironment.status !== "missing";
  }
  return false;
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

export function resolveNewThreadHostEnvironmentProvider({
  currentProviderId,
  providers,
}: {
  currentProviderId: string | null;
  providers: readonly SystemEnvironmentProvider[];
}): SystemEnvironmentProvider | null {
  const usable = providers.filter(
    (provider) =>
      provider.machineProviderId === null &&
      provider.availability?.status !== "unavailable",
  );
  return (
    usable.find((provider) => provider.id === currentProviderId) ??
    usable[0] ??
    null
  );
}

export function buildReuseThreadOptions(
  threads: readonly ThreadListEntry[],
  hostNameById: ReadonlyMap<string, string> | null = null,
): ReuseThreadOption[] {
  const threadsByEnvironmentId = new Map<string, ThreadListEntry[]>();
  const branchByEnvironmentId = new Map<string, string | null>();
  const nameByEnvironmentId = new Map<string, string | null>();
  const pathByEnvironmentId = new Map<string, string | null>();
  const providerIdByEnvironmentId = new Map<string, string | null>();
  const hostIdByEnvironmentId = new Map<string, string | null>();
  for (const thread of threads) {
    if (thread.environmentId === null) continue;
    let bucket = threadsByEnvironmentId.get(thread.environmentId);
    if (!bucket) {
      bucket = [];
      threadsByEnvironmentId.set(thread.environmentId, bucket);
      branchByEnvironmentId.set(
        thread.environmentId,
        thread.environmentBranchName,
      );
      nameByEnvironmentId.set(thread.environmentId, thread.environmentName);
      pathByEnvironmentId.set(thread.environmentId, thread.environmentPath);
      providerIdByEnvironmentId.set(
        thread.environmentId,
        thread.environmentProviderId,
      );
      hostIdByEnvironmentId.set(thread.environmentId, thread.environmentHostId);
    }
    bucket.push(thread);
  }
  const options: ReuseThreadOption[] = [];
  for (const [environmentId, bucket] of threadsByEnvironmentId) {
    bucket.sort(
      (left, right) => right.latestAttentionAt - left.latestAttentionAt,
    );
    const hostId = hostIdByEnvironmentId.get(environmentId) ?? null;
    options.push({
      environmentId,
      branchName: branchByEnvironmentId.get(environmentId) ?? null,
      name: nameByEnvironmentId.get(environmentId) ?? null,
      path: pathByEnvironmentId.get(environmentId) ?? null,
      environmentProviderId:
        providerIdByEnvironmentId.get(environmentId) ?? null,
      hostName:
        hostNameById !== null && hostId !== null
          ? (hostNameById.get(hostId) ?? null)
          : null,
      threads: bucket.map((thread) => ({
        id: thread.id,
        title: getThreadDisplayTitle(thread),
      })),
    });
  }
  options.sort((left, right) => {
    const leftLabel = left.name ?? left.branchName;
    const rightLabel = right.name ?? right.branchName;
    if (leftLabel && rightLabel) {
      return leftLabel.localeCompare(rightLabel);
    }
    return left.environmentId.localeCompare(right.environmentId);
  });
  return options;
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
  seededReuseEnvironment,
}: ResolveProjectlessEnvironmentValueArgs): string {
  if (
    parsedSelection?.type === "reuse" &&
    parsedSelection.environmentId !== null &&
    reuseSelectionSurvives({
      environmentId: parsedSelection.environmentId,
      reuseThreadOptions,
      reuseThreadOptionsLoading,
      seededReuseEnvironment,
    })
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
  seededReuseEnvironment,
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
      seededReuseEnvironment,
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

  if (parsedSelection?.type === "reuse") {
    if (parsedSelection.environmentId === null) {
      return environmentSelectionValue;
    }

    return reuseSelectionSurvives({
      environmentId: parsedSelection.environmentId,
      reuseThreadOptions,
      reuseThreadOptionsLoading,
      seededReuseEnvironment,
    })
      ? environmentSelectionValue
      : fallbackValue;
  }

  if (
    selectedProvider !== undefined &&
    (selectedProvider.machineProviderId !== null || primaryHostId !== null)
  ) {
    return environmentSelectionValue;
  }

  return fallbackValue;
}

export interface UsableProjectDefaultEnvironment {
  value: string;
  hostId: string | null;
}

const AUTOMATIC_PROJECT_DEFAULT_ENVIRONMENT_LABEL = "Automatic";

export function projectDefaultEnvironmentLabel({
  defaultEnvironment,
  providers,
  hosts,
}: {
  defaultEnvironment: ProjectResponse["defaultEnvironment"];
  providers:
    | readonly Pick<SystemEnvironmentProvider, "id" | "displayName">[]
    | undefined;
  hosts: readonly Pick<Host, "id" | "name">[] | undefined;
}): string {
  if (defaultEnvironment === null) {
    return AUTOMATIC_PROJECT_DEFAULT_ENVIRONMENT_LABEL;
  }
  const providerName =
    providers?.find(
      (provider) => provider.id === defaultEnvironment.environmentProviderId,
    )?.displayName ?? defaultEnvironment.environmentProviderId;
  const machine = defaultEnvironment.machine;
  const hostName =
    machine.type === "existing"
      ? hosts?.find((host) => host.id === machine.hostId)?.name
      : undefined;
  return hostName === undefined
    ? providerName
    : `${hostName} · ${providerName}`;
}

interface ResolveUsableProjectDefaultEnvironmentArgs {
  project: Pick<
    ProjectResponse,
    "defaultEnvironment" | "defaultEnvironmentProblem"
  > | null;
  environmentProviders: readonly SystemEnvironmentProvider[] | undefined;
  environmentProvidersByHostId: ReadonlyMap<
    string,
    readonly SystemEnvironmentProvider[]
  >;
  knownHostIds: ReadonlySet<string>;
}

export function resolveUsableProjectDefaultEnvironment({
  project,
  environmentProviders,
  environmentProvidersByHostId,
  knownHostIds,
}: ResolveUsableProjectDefaultEnvironmentArgs): UsableProjectDefaultEnvironment | null {
  const defaultEnvironment = project?.defaultEnvironment ?? null;
  if (defaultEnvironment === null || project?.defaultEnvironmentProblem) {
    return null;
  }
  const provider = environmentProviders?.find(
    (candidate) => candidate.id === defaultEnvironment.environmentProviderId,
  );
  if (provider === undefined) return null;
  const value = encodeProviderValue(provider.id);
  if (provider.machineProviderId) return { value, hostId: null };
  const machine = defaultEnvironment.machine;
  if (machine.type !== "existing" || !knownHostIds.has(machine.hostId)) {
    return null;
  }
  const available =
    environmentProvidersByHostId
      .get(machine.hostId)
      ?.some(
        (candidate) =>
          candidate.id === provider.id &&
          candidate.availability?.status !== "unavailable",
      ) ?? false;
  return available ? { value, hostId: machine.hostId } : null;
}
