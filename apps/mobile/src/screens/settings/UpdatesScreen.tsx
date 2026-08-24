import type { Host } from "@bb/domain";
import type { SystemVersionResponse } from "@bb/server-contract";
import * as Clipboard from "expo-clipboard";
import { useMemo, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { useProfiles } from "@/app-shell";
import {
  formatRelativeAge,
  formatHostUpdateStatus,
  useHosts,
  useProviderCliInstallRunner,
  useRetryHostUpdate,
} from "@/data/hosts";
import {
  CLI_SKILLS_SETTING_LABEL,
  cliSkillsInstallDescription,
  cliSkillsMachineStatusLabel,
  cliSkillsStatusByHostId,
  describeCliSkillsInstallResults,
  summarizeMachineStatuses,
  useCliSkillsStatus,
  useInstallCliSkills,
} from "@/data/settings";
import {
  actionableProviderIssues,
  bbAppRowState,
  summarizeMachineUpdates,
  useCheckForUpdates,
  useUpdateInventory,
  type UpdateInventoryMachine,
} from "@/data/updates";
import { useTheme } from "@/theme";
import {
  Button,
  EmptyStatePanel,
  Icon,
  ListRow,
  Pill,
  Separator,
  Sheet,
  Spinner,
  Text,
  toast,
  useSheet,
} from "@/ui";
import {
  ProviderCliInstallLogHost,
  ProviderCliRows,
} from "../machines/ProviderCliRows";
import { HostStatusDot } from "../pickers";
import { Screen } from "../shell/Screen";
import { useNow } from "../shell/use-now";
import { SettingsControlRow, SettingsSection } from "./SettingsRows";

const CHANGELOG_URL = "https://github.com/get-bb/bb/blob/main/CHANGELOG.md";

/**
 * `/settings/updates` (web UpdatesSettingsSection + CliSkillsSettingsSection):
 * the bb-app version against the registry, every machine's provider CLIs
 * with Install / Update, stranded daemons with Retry, and the bb CLI skills
 * install per machine.
 */
export function UpdatesScreen() {
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <Screen testID="updates-screen">
        <EmptyStatePanel>Add a server first.</EmptyStatePanel>
      </Screen>
    );
  }
  return <ConnectedUpdatesScreen />;
}

function BbAppRow({
  systemVersion,
}: {
  systemVersion: SystemVersionResponse | undefined;
}) {
  const state = bbAppRowState(systemVersion);
  const copyUpgradeCommand = (command: string) => {
    void Clipboard.setStringAsync(command)
      .then(() => toast.success("Upgrade command copied"))
      .catch(() => toast.error("Couldn't copy upgrade command"));
  };
  return (
    <View className="gap-2 px-4 py-3" testID="updates-bb-row">
      <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
        <View className="min-w-0 flex-1 flex-row items-baseline gap-2">
          <Text variant="label">bb-app</Text>
          {state.kind !== "checking" ? (
            <Text variant="mono" tone="readback" className="text-xs">
              {state.current}
              {state.kind === "available" && state.latest !== null
                ? ` → ${state.latest}`
                : ""}
            </Text>
          ) : null}
        </View>
        {state.kind === "checking" ? (
          <Text variant="caption">Checking…</Text>
        ) : state.kind === "development" ? (
          <Text variant="caption">Development mode</Text>
        ) : state.kind === "available" ? (
          <Text variant="caption" tone="warning">
            Available
          </Text>
        ) : (
          <Text variant="caption">Up to date</Text>
        )}
      </View>
      {state.kind === "available" ? (
        <View className="flex-row flex-wrap items-center gap-2">
          <Text variant="mono" className="shrink text-xs" numberOfLines={1}>
            {state.upgradeCommand}
          </Text>
          <Button
            size="sm"
            variant="outline"
            icon="Copy"
            onPress={() => copyUpgradeCommand(state.upgradeCommand)}
            testID="updates-copy-upgrade"
          >
            Copy
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function MachineUpdatesBlock({
  machine,
  showPrimaryBadge,
  serverProtocolVersion,
  runner,
  retryPending,
  onRetry,
}: {
  machine: UpdateInventoryMachine;
  showPrimaryBadge: boolean;
  serverProtocolVersion: number | null;
  runner: ReturnType<typeof useProviderCliInstallRunner>;
  retryPending: boolean;
  onRetry: () => void;
}) {
  const { host } = machine;
  const stranded = machine.canRetryDaemonUpdate;
  const daemonStatus = formatHostUpdateStatus(host, serverProtocolVersion);
  return (
    <View testID={`updates-machine-${host.id}`}>
      <View className="flex-row items-center gap-2 bg-surface-recessed px-4 py-2">
        <HostStatusDot connected={host.status === "connected"} />
        <Text variant="label" numberOfLines={1} className="shrink">
          {host.name}
        </Text>
        {showPrimaryBadge ? (
          <Pill variant="outline" size="sm">
            Primary
          </Pill>
        ) : null}
        <View className="flex-1" />
        {stranded ? (
          <Button
            size="sm"
            variant="outline"
            loading={retryPending}
            onPress={onRetry}
            testID={`updates-retry-${host.id}`}
          >
            Retry update
          </Button>
        ) : null}
      </View>
      {stranded ? (
        <View className="gap-0.5 px-4 py-3">
          <Text variant="caption" tone="destructive">
            Can't connect — its bb agent is out of date
          </Text>
          <Text variant="chrome">Usually it updates itself.</Text>
          {daemonStatus ? <Text variant="chrome">{daemonStatus}</Text> : null}
        </View>
      ) : (
        <ProviderCliRows
          host={host}
          status={machine.providerStatus}
          statusPending={machine.statusPending}
          statusError={machine.statusError}
          issues={machine.issues}
          runner={runner}
          testIDPrefix={`updates-${host.id}`}
        />
      )}
    </View>
  );
}

function CliSkillsSection({ hosts }: { hosts: readonly Host[] }) {
  const { tokens } = useTheme();
  const statusQuery = useCliSkillsStatus();
  const install = useInstallCliSkills();
  const pickerSheet = useSheet();
  const statuses = useMemo(
    () => cliSkillsStatusByHostId(statusQuery.data),
    [statusQuery.data],
  );
  const connectedHostIds = useMemo(
    () => hosts.filter((host) => host.status === "connected").map((h) => h.id),
    [hosts],
  );
  const hasConnectedMachine = connectedHostIds.length > 0;
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const selectedIds: readonly string[] =
    selected === null
      ? connectedHostIds
      : connectedHostIds.filter((id) => selected.has(id));

  const runInstall = (hostIds: readonly string[]) => {
    if (hostIds.length === 0) return;
    install.mutate(
      { hostIds: [...hostIds] },
      {
        onSuccess: (result) => {
          pickerSheet.dismiss();
          const report = describeCliSkillsInstallResults(result);
          if (report.successMessage) toast.success(report.successMessage);
          for (const message of report.failureMessages) toast.error(message);
          void statusQuery.refetch();
        },
      },
    );
  };

  return (
    <>
      <SettingsSection title="Skills">
        <SettingsControlRow
          label={CLI_SKILLS_SETTING_LABEL}
          badge={summarizeMachineStatuses([...statuses.values()]) ?? undefined}
          description={cliSkillsInstallDescription(hasConnectedMachine)}
          control={
            <Button
              size="sm"
              variant="outline"
              disabled={!hasConnectedMachine}
              loading={install.isPending}
              onPress={() => {
                if (hosts.length > 1) {
                  setSelected(new Set(connectedHostIds));
                  pickerSheet.present();
                } else {
                  runInstall(connectedHostIds);
                }
              }}
              testID="updates-install-cli-skills"
            >
              Install
            </Button>
          }
        />
      </SettingsSection>
      <Sheet
        controller={pickerSheet}
        title="Install bb CLI skills"
        layout="scroll"
      >
        <View className="px-4 pb-2">
          <Text variant="caption">
            Choose the machines to install them onto. Each one gets the skills
            in ~/.agents/skills and ~/.claude/skills, replacing any copy already
            there.
          </Text>
        </View>
        {hosts.map((host) => {
          const connected = host.status === "connected";
          const checked = selectedIds.includes(host.id);
          return (
            <ListRow
              key={host.id}
              title={host.name}
              subtitle={
                cliSkillsMachineStatusLabel({
                  host,
                  status: statuses.get(host.id),
                }) ?? undefined
              }
              leading={
                <View className="w-5 items-center">
                  <HostStatusDot connected={connected} />
                </View>
              }
              trailing={
                checked ? (
                  <Icon name="Check" size={18} color={tokens.foreground} />
                ) : null
              }
              selected={checked}
              disabled={!connected}
              onPress={() => {
                const next = new Set(selectedIds);
                if (next.has(host.id)) next.delete(host.id);
                else next.add(host.id);
                setSelected(next);
              }}
              testID={`cli-skills-machine-${host.id}`}
            />
          );
        })}
        <Separator />
        <View className="flex-row justify-end gap-2 px-4 py-3">
          <Button variant="ghost" onPress={pickerSheet.dismiss}>
            Cancel
          </Button>
          <Button
            disabled={selectedIds.length === 0}
            loading={install.isPending}
            onPress={() => runInstall(selectedIds)}
            testID="cli-skills-install-confirm"
          >
            {selectedIds.length > 1
              ? `Install on ${selectedIds.length} machines`
              : "Install"}
          </Button>
        </View>
      </Sheet>
    </>
  );
}

function ConnectedUpdatesScreen() {
  const { tokens } = useTheme();
  const inventory = useUpdateInventory();
  const hostsQuery = useHosts();
  const hosts = useMemo(() => hostsQuery.data ?? [], [hostsQuery.data]);
  const runner = useProviderCliInstallRunner();
  const retryUpdate = useRetryHostUpdate();
  const check = useCheckForUpdates();
  const now = useNow(30_000);

  const actionable = actionableProviderIssues(inventory.machines).filter(
    ({ hostId, issue }) =>
      !runner.isRunning(hostId, issue.provider) &&
      !runner.isQueued(hostId, issue.provider),
  );
  const activeInstallCount = inventory.machines.reduce(
    (count, machine) =>
      count +
      machine.issues.filter(
        (issue) =>
          runner.isRunning(machine.host.id, issue.provider) ||
          runner.isQueued(machine.host.id, issue.provider),
      ).length,
    0,
  );
  const machineSummary = summarizeMachineUpdates({
    machines: inventory.machines,
    activeInstallCount,
    pendingActionableCount: actionable.length,
  });
  const checkedLabel =
    inventory.lastCheckedAt === null
      ? null
      : `Checked ${formatRelativeAge(inventory.lastCheckedAt, now)}`;
  const connectedHostIds = inventory.machines
    .filter((machine) => machine.host.status === "connected")
    .map((machine) => machine.host.id);

  return (
    <>
      <Screen testID="updates-screen">
        <SettingsSection
          title="bb"
          footnote="Connected machines follow the server version automatically."
          action={
            <View className="flex-row items-center gap-3">
              {check.isPending || checkedLabel !== null ? (
                <Text variant="caption" testID="updates-checked-label">
                  {check.isPending ? "Checking…" : checkedLabel}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Check for updates"
                hitSlop={8}
                disabled={check.isPending}
                onPress={() => check.mutate(connectedHostIds)}
                testID="updates-check"
              >
                {check.isPending ? (
                  <Spinner size="small" color={tokens.mutedForeground} />
                ) : (
                  <Icon
                    name="RotateCcw"
                    size={18}
                    color={tokens.mutedForeground}
                  />
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="What's new"
                hitSlop={8}
                onPress={() => {
                  Linking.openURL(CHANGELOG_URL).catch(() => {
                    toast.error("Could not open the changelog");
                  });
                }}
                testID="updates-whats-new"
              >
                <Text variant="caption" tone="foreground">
                  What's new
                </Text>
              </Pressable>
            </View>
          }
        >
          <BbAppRow systemVersion={inventory.systemVersion} />
        </SettingsSection>

        <SettingsSection
          title="Machines"
          action={
            machineSummary === null && actionable.length === 0 ? undefined : (
              <View className="flex-row items-center gap-2">
                {machineSummary ? (
                  <Text variant="caption" testID="updates-machine-summary">
                    {machineSummary}
                  </Text>
                ) : null}
                {actionable.length > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onPress={() => {
                      for (const { hostId, issue } of actionable) {
                        runner.startInstall({ hostId, issue });
                      }
                    }}
                    testID="updates-update-all"
                  >
                    Update all ({actionable.length})
                  </Button>
                ) : null}
              </View>
            )
          }
        >
          {inventory.machines.length === 0 ? (
            <View className="px-4 py-4">
              <Text variant="caption">
                {inventory.isLoading ? "Loading…" : "No machines yet."}
              </Text>
            </View>
          ) : (
            inventory.machines.map((machine, index) => (
              <View key={machine.host.id}>
                {index > 0 ? <Separator /> : null}
                <MachineUpdatesBlock
                  machine={machine}
                  showPrimaryBadge={
                    inventory.machines.length > 1 && machine.isPrimary
                  }
                  serverProtocolVersion={inventory.serverProtocolVersion}
                  runner={runner}
                  retryPending={
                    retryUpdate.isPending &&
                    retryUpdate.variables === machine.host.id
                  }
                  onRetry={() =>
                    retryUpdate.mutate(machine.host.id, {
                      onSuccess: () =>
                        toast.success(
                          `Update retry requested for ${machine.host.name}`,
                        ),
                    })
                  }
                />
              </View>
            ))
          )}
        </SettingsSection>

        <CliSkillsSection hosts={hosts} />
      </Screen>
      <ProviderCliInstallLogHost runner={runner} />
    </>
  );
}
