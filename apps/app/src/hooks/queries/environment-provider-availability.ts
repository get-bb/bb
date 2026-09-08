import type { SystemEnvironmentProvider } from "@bb/server-contract";

export function aggregateEnvironmentProviderAvailability(
  providers: readonly SystemEnvironmentProvider[] | undefined,
  byHost: ReadonlyMap<string, readonly SystemEnvironmentProvider[] | undefined>,
): readonly SystemEnvironmentProvider[] | undefined {
  const hosts = [...byHost.values()];
  if (providers === undefined || hosts.some((host) => host === undefined))
    return undefined;
  return providers.map((provider) => {
    const availability = hosts.map(
      (host) =>
        host?.find((candidate) => candidate.id === provider.id)?.availability ??
        null,
    );
    return {
      ...provider,
      availability:
        availability.find((value) => value?.status === "available") ??
        availability.find((value) => value !== null) ??
        null,
    };
  });
}
