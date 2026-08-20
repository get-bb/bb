import type { Host } from "@bb/domain";
import type { ProviderCliStatusResponse } from "@bb/host-daemon-contract/local";
import type { SystemVersionResponse } from "@bb/server-contract";
import {
  hasProviderCliAction,
  providerCliIssues,
  type ProviderCliActionableIssue,
  type ProviderCliIssue,
} from "../hosts/provider-cli-install";
import { hostCanRetryUpdate } from "../hosts/host-update-status";

/**
 * One consolidated view of every update bb knows about (mirror of
 * apps/app/src/hooks/useUpdateInventory.ts without the desktop branch): the
 * bb app itself (npm registry) plus the provider CLIs on every connected
 * machine. Remote daemons follow the server version automatically, so
 * per-machine bb rows only surface when a daemon is stranded.
 */

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
  systemVersion: SystemVersionResponse | undefined;
  /** The server's daemon protocol version; null until `GET /install/version` answers. */
  serverProtocolVersion: number | null;
  /** bb-app has a newer release on the registry (never in development mode). */
  appUpdateAvailable: boolean;
  machines: UpdateInventoryMachine[];
  /** Things a user can act on right now. */
  actionableCount: number;
  /**
   * Epoch ms when the oldest source in the inventory was last checked. Null
   * until the app and every connected machine have returned a result.
   */
  lastCheckedAt: number | null;
}

export interface ProviderStatusInput {
  hostId: string;
  data: ProviderCliStatusResponse | undefined;
  isPending: boolean;
  isError: boolean;
  dataUpdatedAt: number;
}

export interface BuildUpdateInventoryArgs {
  hosts: readonly Host[];
  primaryHostId: string | null;
  systemVersion: SystemVersionResponse | undefined;
  systemVersionUpdatedAt: number;
  serverProtocolVersion: number | null;
  providerStatuses: readonly ProviderStatusInput[];
}

export function buildUpdateInventory(
  args: BuildUpdateInventoryArgs,
): UpdateInventory {
  const statusByHostId = new Map(
    args.providerStatuses.map((entry) => [entry.hostId, entry]),
  );
  const machines: UpdateInventoryMachine[] = args.hosts.map((host) => {
    const status = statusByHostId.get(host.id);
    const providerStatus = status?.data ?? null;
    return {
      host,
      isPrimary: host.id === args.primaryHostId,
      providerStatus,
      statusPending: status?.isPending ?? false,
      statusError: status?.isError ?? false,
      issues: providerStatus === null ? [] : providerCliIssues(providerStatus),
      canRetryDaemonUpdate: hostCanRetryUpdate(
        host,
        args.serverProtocolVersion,
      ),
    };
  });
  const systemVersion = args.systemVersion;
  const appUpdateAvailable =
    systemVersion !== undefined &&
    !systemVersion.isDevelopment &&
    systemVersion.updateAvailable;
  const actionableCount =
    machines.reduce(
      (count, machine) =>
        count + machine.issues.length + (machine.canRetryDaemonUpdate ? 1 : 0),
      0,
    ) + (appUpdateAvailable ? 1 : 0);
  const timestamps = [
    args.systemVersionUpdatedAt,
    ...args.providerStatuses.map((entry) => entry.dataUpdatedAt),
  ];
  const complete =
    timestamps.length > 0 &&
    timestamps.every((value) => Number.isFinite(value) && value > 0);
  return {
    systemVersion,
    serverProtocolVersion: args.serverProtocolVersion,
    appUpdateAvailable,
    machines,
    actionableCount,
    lastCheckedAt: complete ? Math.min(...timestamps) : null,
  };
}

export interface ActionableProviderIssue {
  hostId: string;
  issue: ProviderCliActionableIssue;
}

/** Every install/update bb can run, across machines. */
export function actionableProviderIssues(
  machines: readonly UpdateInventoryMachine[],
): ActionableProviderIssue[] {
  return machines.flatMap((machine) =>
    machine.issues
      .filter(hasProviderCliAction)
      .map((issue) => ({ hostId: machine.host.id, issue })),
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The Machines section's one-line status (web `machineSummary`): the most
 * pressing fact first. Null when nothing is worth saying.
 */
export function summarizeMachineUpdates(args: {
  machines: readonly UpdateInventoryMachine[];
  activeInstallCount: number;
  pendingActionableCount: number;
}): string | null {
  const { machines } = args;
  if (machines.length === 0) return null;
  const stranded = machines.filter((m) => m.canRetryDaemonUpdate).length;
  if (stranded > 0) {
    return `${plural(stranded, "machine", "machines")} can't connect`;
  }
  const unchecked = machines.filter(
    (m) =>
      !m.canRetryDaemonUpdate &&
      (m.host.status !== "connected" || m.statusError),
  ).length;
  if (unchecked > 0) {
    return `${unchecked} ${unchecked === 1 ? "machine was" : "machines were"} not checked`;
  }
  const checking = machines.filter(
    (m) =>
      m.host.status === "connected" &&
      !m.statusError &&
      (m.statusPending || m.providerStatus === null),
  ).length;
  if (checking > 0) {
    return `Checking ${plural(checking, "machine", "machines")}…`;
  }
  if (args.activeInstallCount > 0) {
    return `${plural(args.activeInstallCount, "update", "updates")} in progress`;
  }
  const manual = machines.reduce(
    (count, m) =>
      count +
      m.issues.filter(
        (issue) => issue.status.installed && !hasProviderCliAction(issue),
      ).length,
    0,
  );
  if (manual > 0) {
    return `${manual} ${manual === 1 ? "update needs" : "updates need"} manual action`;
  }
  if (args.pendingActionableCount === 0) {
    return `${plural(machines.length, "machine", "machines")}, all in sync`;
  }
  return null;
}

export type BbAppRowState =
  | { kind: "checking" }
  | { kind: "development"; current: string }
  | {
      kind: "available";
      current: string;
      latest: string | null;
      upgradeCommand: string;
    }
  | { kind: "current"; current: string };

/** The bb-app row (web `BbAppUpdateRows`, web/npm branch). */
export function bbAppRowState(
  version: SystemVersionResponse | undefined,
): BbAppRowState {
  if (version === undefined) return { kind: "checking" };
  if (version.isDevelopment) {
    return { kind: "development", current: version.currentVersion };
  }
  if (version.updateAvailable) {
    return {
      kind: "available",
      current: version.currentVersion,
      latest: version.latestVersion,
      upgradeCommand: version.upgradeCommand,
    };
  }
  return { kind: "current", current: version.currentVersion };
}
