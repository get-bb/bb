import {
  findLocalPathProjectSourceForHost,
  type Host,
  type ProjectSource,
} from "@bb/domain";
import type { SystemEnvironmentProvider } from "@bb/server-contract";

interface BuildEnvironmentProvidersByHostIdArgs {
  hosts: readonly Host[];
  environmentProviders: readonly SystemEnvironmentProvider[] | undefined;
  projectEnvironmentProviders: readonly SystemEnvironmentProvider[] | undefined;
  projectGitRemoteUrl: string | null | undefined;
  projectSources: readonly ProjectSource[];
}

export function buildEnvironmentProvidersByHostId({
  hosts,
  environmentProviders,
  projectEnvironmentProviders,
  projectGitRemoteUrl,
  projectSources,
}: BuildEnvironmentProvidersByHostIdArgs): Map<
  string,
  SystemEnvironmentProvider[]
> {
  return new Map(
    hosts.map((host) => [
      host.id,
      (environmentProviders ?? [])
        .filter(
          (provider) =>
            !provider.machineProviderId &&
            (!(
              provider.requires.projectCheckout || provider.requires.gitCheckout
            ) ||
              findLocalPathProjectSourceForHost(projectSources, host.id) !==
                undefined) &&
            (!provider.requires.gitRemote || projectGitRemoteUrl != null),
        )
        .map((provider) => ({
          ...provider,
          availability:
            projectEnvironmentProviders?.find(
              (candidate) => candidate.id === provider.id,
            )?.machineAvailability[host.id] ?? null,
        })),
    ]),
  );
}
