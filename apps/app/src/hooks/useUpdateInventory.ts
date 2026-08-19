import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { Host } from "@bb/domain";
import type { ProviderCliStatusResponse } from "@bb/host-daemon-contract";
import type { SystemVersionResponse } from "@bb/server-contract";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import {
  buildProviderCliIssue,
  isProviderCliIssue,
  providerCliEntries,
  type ProviderCliIssue,
} from "@/components/provider-cli/provider-cli-install";
import { useDesktopUpdateInfo } from "@/hooks/useDesktopUpdateInfo";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
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
  /** Null while the host is offline or its status is still loading. */
  providerStatus: ProviderCliStatusResponse | null;
  statusPending: boolean;
  statusError: boolean;
  issues: ProviderCliIssue[];
  /** Daemon stuck on an old protocol version; the server can force a retry. */
  canRetryDaemonUpdate: boolean;
}

export interface UpdateInventory {
  isLoading: boolean;
  systemVersion: SystemVersionResponse | undefined;
  desktopInfo: BbDesktopInfo | null;
  /** bb-app (web/npm) has a newer release on the registry. */
  appUpdateAvailable: boolean;
  /** Desktop shell downloaded an update; a relaunch applies it. */
  desktopUpdateReady: boolean;
  machines: UpdateInventoryMachine[];
  /** Enabled plugins that are not running (incompatible, error, missing). */
  pluginAttentionCount: number;
  /** Count of things a user can act on right now. */
  actionableCount: number;
  hasAttention: boolean;
  /**
   * Epoch ms when the oldest source in the current inventory was last checked.
   * Null until the app and every connected machine have returned a result.
   * Using the oldest source prevents one fresh response from making stale
   * machine data look current.
   */
  lastCheckedAt: number | null;
}

interface UseUpdateInventoryOptions {
  enabled?: boolean;
}

/**
 * One consolidated view of every update bb knows about: the bb app itself
 * (npm registry / desktop feed) plus provider CLIs on every connected
 * machine. Remote daemons follow the server version automatically via
 * protocol self-update, so per-machine bb rows only surface when a daemon is
 * stuck and needs a manual retry.
 */
export function useUpdateInventory(
  options?: UseUpdateInventoryOptions,
): UpdateInventory {
  const enabled = options?.enabled ?? true;
  const systemVersionQuery = useSystemVersion({ enabled });
  const systemConfigQuery = useSystemConfig({ enabled });
  const hostsQuery = useHosts({ enabled });
  const { desktopInfo, isDesktop } = useDesktopUpdateInfo();
  const pluginAttentionCount = pluginsNeedingAttention(
    usePluginList({ enabled }).data?.plugins ?? [],
  ).length;

  const hosts = useMemo(() => hostsQuery.data ?? [], [hostsQuery.data]);
  const connectedHosts = useMemo(
    () => hosts.filter((host) => host.status === "connected"),
    [hosts],
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

  const machines: UpdateInventoryMachine[] = hosts.map((host) => {
    const statusQuery = providerStatusByHostId.get(host.id);
    const providerStatus = statusQuery?.data ?? null;
    const issues =
      providerStatus === null
        ? []
        : providerCliEntries(providerStatus)
            .map(buildProviderCliIssue)
            .filter(isProviderCliIssue);
    return {
      host,
      isPrimary: host.id === primaryHostId,
      providerStatus,
      statusPending: statusQuery?.isPending ?? false,
      statusError: statusQuery?.isError ?? false,
      issues,
      canRetryDaemonUpdate: hostCanRetryUpdate(host),
    };
  });

  const systemVersion = systemVersionQuery.data;
  // Gate on `isDesktop`, not on `desktopInfo`: the desktop shell answers
  // `getInfo()` a render or two after mount, and treating that gap as "web"
  // flashes an npm-upgrade prompt the desktop build never uses.
  const appUpdateAvailable =
    !isDesktop &&
    systemVersion !== undefined &&
    !systemVersion.isDevelopment &&
    systemVersion.updateAvailable;
  const desktopUpdateReady = desktopInfo?.updateDownloaded === true;
  const actionableCount =
    machines.reduce(
      (count, machine) =>
        count + machine.issues.length + (machine.canRetryDaemonUpdate ? 1 : 0),
      0,
    ) +
    (appUpdateAvailable ? 1 : 0) +
    (desktopUpdateReady ? 1 : 0) +
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
    pluginAttentionCount,
    actionableCount,
    hasAttention: actionableCount > 0,
    lastCheckedAt,
  };
}
