import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { Host } from "@bb/domain";
import type { ProviderCliStatusResponse } from "@bb/host-daemon-contract";
import type {
  SystemAppUpdateStatus,
  SystemVersionResponse,
} from "@bb/server-contract";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import {
  buildProviderCliIssue,
  isProviderCliIssue,
  isProviderCliUpdateIssue,
  providerCliEntries,
  type ProviderCliIssue,
} from "@/components/provider-cli/provider-cli-install";
import { hasActionableReleaseUpdate } from "@/components/app-update/app-update-presentation";
import { useAppUpdateStatus } from "@/hooks/queries/app-update-queries";
import { useDesktopUpdateInfo } from "@/hooks/useDesktopUpdateInfo";
import {
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { pluginHasUpdateSurfaces } from "@/components/plugin/management/PluginUpdatesCard";
import { pluginsNeedingAttention } from "@/hooks/usePluginAttention";
import { selectPrimaryHost, useHosts } from "@/hooks/queries/host-queries";
import { hostProviderCliStatusQueryKey } from "@/hooks/queries/query-keys";
import { SESSION_STATIC_QUERY_POLICY } from "@/hooks/queries/query-policies";
import {
  useSystemConfig,
  useSystemVersion,
} from "@/hooks/queries/system-queries";
import { hostCanRetryUpdate } from "@/lib/host-update-status";
import { sdk } from "@/lib/sdk";

export interface UpdateInventoryMachine {
  host: Host;
  isPrimary: boolean;
  providerStatus: ProviderCliStatusResponse | null;
  statusPending: boolean;
  statusError: boolean;
  statusFetching: boolean;
  issues: ProviderCliIssue[];
  canRetryDaemonUpdate: boolean;
}

export type UpdateInventoryPlugin =
  | { kind: "update"; plugin: PluginListItem; version: string }
  | {
      kind: "blocked";
      plugin: PluginListItem;
      version: string;
      reasons: string[];
    };

export interface UpdateInventoryPlugins {
  trackedCount: number;
  items: UpdateInventoryPlugin[];
}

export interface UpdateInventory {
  isLoading: boolean;
  systemVersion: SystemVersionResponse | undefined;
  desktopInfo: BbDesktopInfo | null;
  appUpdateAvailable: boolean;
  desktopUpdateReady: boolean;
  machines: UpdateInventoryMachine[];
  plugins: UpdateInventoryPlugins | null;
  pluginAttentionCount: number;
  actionableCount: number;
  hasAttention: boolean;
  lastCheckedAt: number | null;
}

interface UseUpdateInventoryOptions {
  enabled?: boolean;
}

export function buildUpdateInventoryProviderIssues(
  providerStatus: ProviderCliStatusResponse,
): ProviderCliIssue[] {
  return providerCliEntries(providerStatus)
    .map(buildProviderCliIssue)
    .filter(isProviderCliIssue);
}

export function buildUpdateInventoryPlugins(
  plugins: readonly PluginListItem[],
): UpdateInventoryPlugins {
  const tracked = plugins.filter(
    (plugin) =>
      pluginHasUpdateSurfaces(plugin) &&
      plugin.updateState.outcome !== "pinned",
  );
  const items = tracked.flatMap((plugin): UpdateInventoryPlugin[] => {
    const { availableLabel, blockedLabel, blockedReasons } = plugin.updateState;
    if (availableLabel !== null) {
      return [{ kind: "update", plugin, version: availableLabel }];
    }
    if (blockedLabel !== null) {
      return [
        {
          kind: "blocked",
          plugin,
          version: blockedLabel,
          reasons: blockedReasons,
        },
      ];
    }
    return [];
  });
  items.sort((a, b) =>
    (a.plugin.name ?? a.plugin.id).localeCompare(b.plugin.name ?? b.plugin.id),
  );
  return { trackedCount: tracked.length, items };
}

export function resolveAppUpdateAvailable(args: {
  appUpdate: SystemAppUpdateStatus | undefined;
  isDesktop: boolean;
  systemVersion: SystemVersionResponse | undefined;
}): boolean {
  if (hasActionableReleaseUpdate(args.appUpdate)) return true;
  return (
    !args.isDesktop &&
    args.systemVersion !== undefined &&
    !args.systemVersion.isDevelopment &&
    args.systemVersion.updateAvailable
  );
}

export function updateInventoryHosts(hosts: readonly Host[]): Host[] {
  return hosts.filter((host) => host.type !== "ephemeral");
}

export function useUpdateInventory(
  options?: UseUpdateInventoryOptions,
): UpdateInventory {
  const enabled = options?.enabled ?? true;
  const systemVersionQuery = useSystemVersion({ enabled });
  const appUpdateStatusQuery = useAppUpdateStatus({ enabled });
  const systemConfigQuery = useSystemConfig({ enabled });
  const hostsQuery = useHosts({ enabled });
  const { desktopInfo, isDesktop } = useDesktopUpdateInfo();
  const installedPlugins = usePluginList({ enabled }).data?.plugins;
  const pluginAttentionCount = pluginsNeedingAttention(
    installedPlugins ?? [],
  ).length;
  const pluginUpdatesEnabled =
    systemConfigQuery.data?.experiments.pluginUpdates === true;
  const plugins = useMemo(
    () =>
      pluginUpdatesEnabled
        ? buildUpdateInventoryPlugins(installedPlugins ?? [])
        : null,
    [installedPlugins, pluginUpdatesEnabled],
  );

  const hosts = useMemo(() => hostsQuery.data ?? [], [hostsQuery.data]);
  const updateHosts = updateInventoryHosts(hosts);
  const connectedHosts = updateHosts.filter(
    (host) => host.status === "connected",
  );
  const primaryHostId =
    selectPrimaryHost(hosts, systemConfigQuery.data?.primaryHostId ?? null)
      ?.id ?? null;

  const providerStatusQueries = useQueries({
    queries: connectedHosts.map((host) => ({
      queryKey: hostProviderCliStatusQueryKey(host.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        sdk.hosts.providerCliStatus({ hostId: host.id, signal }),
      enabled,
      ...SESSION_STATIC_QUERY_POLICY,
    })),
  });
  const providerStatusByHostId = new Map<
    string,
    (typeof providerStatusQueries)[number]
  >();
  connectedHosts.forEach((host, index) => {
    const query = providerStatusQueries[index];
    if (query !== undefined) {
      providerStatusByHostId.set(host.id, query);
    }
  });

  const machines: UpdateInventoryMachine[] = updateHosts.map((host) => {
    const statusQuery = providerStatusByHostId.get(host.id);
    const providerStatus = statusQuery?.data ?? null;
    const issues =
      providerStatus === null
        ? []
        : buildUpdateInventoryProviderIssues(providerStatus);
    return {
      host,
      isPrimary: host.id === primaryHostId,
      providerStatus,
      statusPending: statusQuery?.isPending ?? false,
      statusError: statusQuery?.isError ?? false,
      statusFetching: statusQuery?.isFetching ?? false,
      issues,
      canRetryDaemonUpdate: hostCanRetryUpdate(host),
    };
  });

  const systemVersion = systemVersionQuery.data;
  const appUpdateAvailable = resolveAppUpdateAvailable({
    appUpdate: appUpdateStatusQuery.data,
    isDesktop,
    systemVersion,
  });
  const desktopUpdateReady = desktopInfo?.updateDownloaded === true;
  const actionableCount =
    machines.reduce(
      (count, machine) =>
        count +
        machine.issues.filter(isProviderCliUpdateIssue).length +
        (machine.canRetryDaemonUpdate ? 1 : 0),
      0,
    ) +
    (appUpdateAvailable ? 1 : 0) +
    (desktopUpdateReady ? 1 : 0) +
    (plugins?.items.filter((item) => item.kind === "update").length ?? 0) +
    pluginAttentionCount;

  const desktopLastCheckedAt =
    desktopInfo?.lastCheckedAt === null ||
    desktopInfo?.lastCheckedAt === undefined
      ? 0
      : Date.parse(desktopInfo.lastCheckedAt);
  const checkTimestamps = [
    isDesktop ? desktopLastCheckedAt : systemVersionQuery.dataUpdatedAt,
    ...providerStatusQueries.map((query) => query.dataUpdatedAt),
  ];
  const hasCompleteCheck =
    checkTimestamps.length > 0 &&
    checkTimestamps.every(
      (timestamp) => Number.isFinite(timestamp) && timestamp > 0,
    );
  const lastCheckedAt = hasCompleteCheck ? Math.min(...checkTimestamps) : null;

  return {
    isLoading: systemVersionQuery.isPending || hostsQuery.isPending,
    systemVersion,
    desktopInfo,
    appUpdateAvailable,
    desktopUpdateReady,
    machines,
    plugins,
    pluginAttentionCount,
    actionableCount,
    hasAttention: actionableCount > 0,
    lastCheckedAt,
  };
}
