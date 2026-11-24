import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Environment, Host } from "@bb/domain";
import type {
  ExperimentalEnvironmentHost,
  ExperimentalEnvironmentState,
} from "@get-bb/plugin-sdk";
import { formatEnvironmentDisplay } from "@bb/core-ui";
import type { SystemMachineProvider } from "@bb/server-contract";
import { resolveMachineIconProvider } from "@/components/machines/MachineLabel";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { useSystemEnvironmentProviders } from "@/hooks/queries/environment-provider-queries";
import { selectHosts, useHosts } from "@/hooks/queries/host-queries";
import { useSystemMachineProviders } from "@/hooks/queries/machine-provider-queries";
import { removedHostQueryKey } from "@/hooks/queries/query-keys";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import {
  findEnvironmentDisplayProvider,
  getEnvironmentWorkspaceInfoDisplay,
  isHostAmbiguous,
} from "@/lib/environment-workspace-display";
import { BbHttpError, sdk } from "@/lib/sdk";

const LOADING: ExperimentalEnvironmentState = {
  status: "loading",
  environment: null,
};
const NOT_FOUND: ExperimentalEnvironmentState = {
  status: "notFound",
  environment: null,
};
const ERROR: ExperimentalEnvironmentState = {
  status: "error",
  environment: null,
};

function toEnvironmentHost(
  host: Host,
  {
    local,
    named,
    machineProviders,
  }: {
    local: boolean;
    named: boolean;
    machineProviders: readonly SystemMachineProvider[] | undefined;
  },
): ExperimentalEnvironmentHost {
  const machineProvider = resolveMachineIconProvider(
    host,
    machineProviders?.find(
      (provider) => provider.id === host.machineProviderId,
    ),
  );
  return {
    id: host.id,
    name: host.name,
    connected: host.status === "connected",
    local,
    named,
    machineProvider:
      machineProvider === null
        ? null
        : {
            id: machineProvider.id,
            displayName: machineProvider.displayName,
            icon: machineProvider.icon,
            logoUrl: machineProvider.logoUrl,
          },
  };
}

function useRemovedHostName(
  environment: Environment | undefined,
  isListed: boolean,
  hostsLoaded: boolean,
): string | null {
  const hostId = environment?.hostId ?? "";
  const query = useQuery({
    queryKey: removedHostQueryKey(hostId),
    queryFn: ({ signal }) =>
      sdk.hosts.get({ hostId, includeRemoved: true, signal }),
    enabled:
      environment !== undefined &&
      environment.hostLifecycle !== "active" &&
      hostsLoaded &&
      !isListed,
    staleTime: Infinity,
  });
  return query.data?.name ?? null;
}

export function useEnvironmentState(
  environmentId: string,
): ExperimentalEnvironmentState {
  const query = useEnvironment(environmentId === "" ? null : environmentId, {
    staleTime: 5_000,
  });
  const hostsQuery = useHosts();
  const { providers } = useSystemEnvironmentProviders();
  const { providers: machineProviders } = useSystemMachineProviders();
  const { isLocalDaemonHost } = useHostDaemon();
  const environment = query.data;
  const hosts = hostsQuery.data;
  const listedHost =
    environment === undefined
      ? null
      : (hosts?.find((host) => host.id === environment.hostId) ?? null);
  const removedHostName = useRemovedHostName(
    environment,
    listedHost !== null,
    hosts !== undefined,
  );
  const error = query.data === undefined ? query.error : null;
  return useMemo(() => {
    if (environmentId === "") return NOT_FOUND;
    if (environment === undefined) {
      if (error instanceof BbHttpError && error.status === 404) {
        return NOT_FOUND;
      }
      return error === null ? LOADING : ERROR;
    }
    const local = isLocalDaemonHost(environment.hostId);
    const hasMultipleMachines = selectHosts(hosts, "persistent").length > 1;
    const host: ExperimentalEnvironmentHost | null =
      listedHost !== null
        ? toEnvironmentHost(listedHost, {
            local,
            named:
              environment.hostLifecycle !== "active" ||
              isHostAmbiguous(hasMultipleMachines, listedHost.type),
            machineProviders,
          })
        : environment.hostLifecycle !== "active" && removedHostName !== null
          ? {
              id: environment.hostId,
              name: removedHostName,
              connected: false,
              local,
              named: true,
              machineProvider: null,
            }
          : null;
    const providerLookup = findEnvironmentDisplayProvider(
      providers,
      environment.environmentProviderId,
    );
    const locality = local ? "local" : "remote";
    const display = formatEnvironmentDisplay({
      environment,
      host: {
        locality,
        identity:
          host === null || !host.named
            ? null
            : { name: host.name, connected: host.connected },
      },
      providerLookup,
    });
    const { label } = getEnvironmentWorkspaceInfoDisplay({
      display,
      providerLookup,
      hostName: host?.named === true ? host.name : null,
      locality,
    });
    return {
      status: "ready",
      environment: { ...environment, label, host },
    };
  }, [
    environment,
    environmentId,
    error,
    hosts,
    isLocalDaemonHost,
    listedHost,
    machineProviders,
    providers,
    removedHostName,
  ]);
}
