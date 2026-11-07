import type { ProviderCliKey } from "@bb/host-daemon-contract";
import type { PluginUpdateJob } from "@bb/server-contract";
import {
  hasProviderCliAction,
  isProviderCliUpdateIssue,
  type ProviderCliActionableIssue,
} from "@/components/provider-cli/provider-cli-install";
import {
  providerCliJobKey,
  type ProviderCliInstallFailure,
} from "@/components/provider-cli/provider-cli-install-store";
import type {
  UpdateInventoryMachine,
  UpdateInventoryPlugins,
} from "@/hooks/useUpdateInventory";

export type SidebarUpdateRowState = "available" | "updating" | "failed";

export type SidebarUpdateRow =
  | {
      kind: "provider";
      key: string;
      provider: ProviderCliKey;
      label: string;
      detail: string;
      state: SidebarUpdateRowState;
      start: { hostId: string; issue: ProviderCliActionableIssue } | null;
    }
  | {
      kind: "plugin";
      key: string;
      pluginId: string;
      icon: string | null;
      label: string;
      detail: string;
      state: SidebarUpdateRowState;
      startable: boolean;
    };

export interface SidebarBbUpdate {
  version: string | null;
  currentVersion: string | null;
  installsWhenIdle: boolean;
  restarting: boolean;
  restartLabel: string | null;
}

export interface SidebarUpdateModel {
  bb: SidebarBbUpdate | null;
  rows: SidebarUpdateRow[];
  startableCount: number;
  retryOnly: boolean;
  updating: boolean;
}

export interface ProviderCliJobs {
  runningJobKey: string | null;
  queuedJobKeys: ReadonlySet<string>;
  failuresByJobKey: ReadonlyMap<string, ProviderCliInstallFailure>;
}

function providerRows(
  machines: readonly UpdateInventoryMachine[],
  jobs: ProviderCliJobs,
): SidebarUpdateRow[] {
  const visible = machines.filter(
    (machine) =>
      machine.host.status === "connected" &&
      !machine.canRetryDaemonUpdate &&
      !machine.statusError &&
      !machine.statusPending,
  );
  const multipleMachines =
    visible.filter((machine) => machine.issues.some(isProviderCliUpdateIssue))
      .length > 1;
  return visible.flatMap((machine) =>
    machine.issues.filter(isProviderCliUpdateIssue).map((issue) => {
      const jobKey = providerCliJobKey(machine.host.id, issue.provider);
      const failure = jobs.failuresByJobKey.get(jobKey);
      const state: SidebarUpdateRowState =
        jobs.runningJobKey === jobKey || jobs.queuedJobKeys.has(jobKey)
          ? "updating"
          : failure?.issueFingerprint === issue.fingerprint
            ? "failed"
            : "available";
      const { currentVersion, latestVersion } = issue.status;
      const versions =
        latestVersion === null
          ? (currentVersion ?? "")
          : currentVersion === null
            ? latestVersion
            : `${currentVersion} → ${latestVersion}`;
      return {
        kind: "provider" as const,
        key: jobKey,
        provider: issue.provider,
        label: issue.status.displayName,
        detail: multipleMachines
          ? `${machine.host.name} · ${versions}`
          : versions,
        state,
        start:
          state !== "updating" && hasProviderCliAction(issue)
            ? { hostId: machine.host.id, issue }
            : null,
      };
    }),
  );
}

function pluginRows(
  plugins: UpdateInventoryPlugins | null,
  jobs: readonly PluginUpdateJob[],
): SidebarUpdateRow[] {
  if (plugins === null) return [];
  return plugins.items.flatMap((item) => {
    if (item.kind !== "update") return [];
    const latestJob = jobs
      .filter((job) => job.pluginId === item.plugin.id)
      .at(-1);
    const state: SidebarUpdateRowState =
      latestJob?.state === "queued" || latestJob?.state === "running"
        ? "updating"
        : latestJob?.state === "failed"
          ? "failed"
          : "available";
    return [
      {
        kind: "plugin" as const,
        key: `plugin:${item.plugin.id}`,
        pluginId: item.plugin.id,
        icon: item.plugin.icon,
        label: item.plugin.name ?? item.plugin.id,
        detail: `${item.plugin.version} → ${item.version}`,
        state,
        startable: state !== "updating",
      },
    ];
  });
}

export function buildSidebarUpdateModel(input: {
  bb: SidebarBbUpdate | null;
  machines: readonly UpdateInventoryMachine[];
  plugins: UpdateInventoryPlugins | null;
  providerJobs: ProviderCliJobs;
  pluginJobs: readonly PluginUpdateJob[];
}): SidebarUpdateModel {
  const rows = [
    ...providerRows(input.machines, input.providerJobs),
    ...pluginRows(input.plugins, input.pluginJobs),
  ];
  const startable = rows.filter((row) =>
    row.kind === "provider" ? row.start !== null : row.startable,
  );
  return {
    bb: input.bb,
    rows,
    startableCount: startable.length,
    retryOnly:
      startable.length > 0 && startable.every((row) => row.state === "failed"),
    updating:
      input.bb?.restarting === true ||
      rows.some((row) => row.state === "updating"),
  };
}

export function sidebarUpdateModelIsEmpty(model: SidebarUpdateModel): boolean {
  return model.bb === null && model.rows.length === 0;
}
