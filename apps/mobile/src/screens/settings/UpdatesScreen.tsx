import type { Host } from "@bb/domain";
import * as Clipboard from "expo-clipboard";
import { Stack } from "expo-router";
import { useMemo, useState } from "react";
import { Linking, View } from "react-native";
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
import {
  Button,
  EmptyStatePanel,
  GroupedRow,
  ListRow,
  Separator,
  Sheet,
  Text,
  toast,
  useSheet,
} from "@/ui";
import {
  ProviderCliInstallLogHost,
  ProviderCliRows,
} from "../machines/ProviderCliRows";
import { HostStatusDot } from "../pickers";
import { useNow } from "../shell/use-now";
import { GroupedScreen } from "./GroupedScreen";
import {
  HeaderIconButton,
  ICON_ROW_SEPARATOR_INSET,
  SettingsControlRow,
  SettingsSection,
} from "./SettingsRows";

const IS_IOS = process.env.EXPO_OS === "ios";
const CHANGELOG_URL = "https://github.com/get-bb/bb/blob/main/CHANGELOG.md";

function openChangelog(): void {
  Linking.openURL(CHANGELOG_URL).catch(() => {
    toast.error("Could not open the changelog");
  });
}

/**
 * `/settings/updates` (web UpdatesSettingsSection + CliSkillsSettingsSection):
 * the bb-app version against the registry, every machine's provider CLIs
 * with Install / Update, stranded daemons with Retry, and the bb CLI skills
 * install per machine. Check / What's new live in the header on iOS.
 */
export function UpdatesScreen() {
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <GroupedScreen testID="updates-screen">
        <EmptyStatePanel>Add a server first.</EmptyStatePanel>
      </GroupedScreen>
    );
  }
  return <ConnectedUpdatesScreen />;
}

function copyUpgradeCommand(command: string): void {
  void Clipboard.setStringAsync(command)
    .then(() => toast.success("Upgrade command copied"))
    .catch(() => toast.error("Couldn't copy upgrade command"));
}

/** The bb-app version row: current (→ latest) under the name, the state as the value. */
function BbAppRow({ state }: { state: ReturnType<typeof bbAppRowState> }) {
  const version =
    state.kind === "checking"
      ? undefined
      : state.kind === "available" && state.latest !== null
        ? `${state.current} → ${state.latest}`
        : state.current;
  const status =
    state.kind === "checking"
      ? "Checking…"
      : state.kind === "development"
        ? "Development mode"
        : state.kind === "available"
          ? "Update available"
          : "Up to date";
  return (
    <GroupedRow
      title="bb-app"
      subtitle={version}
      value={status}
      valueTone={state.kind === "available" ? "warning" : "default"}
      selectable
      testID="updates-bb-row"
    />
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
      <GroupedRow
        title={host.name}
        value={showPrimaryBadge ? "Primary" : undefined}
        leading={
          <View className="w-5 items-center">
            <HostStatusDot connected={host.status === "connected"} />
          </View>
        }
        trailing={
          stranded ? (
            <Button
              size="sm"
              variant="outline"
              loading={retryPending}
              onPress={onRetry}
              testID={`updates-retry-${host.id}`}
            >
              Retry update
            </Button>
          ) : undefined
        }
      />
      <Separator inset={ICON_ROW_SEPARATOR_INSET} />
      {stranded ? (
        <View className="gap-0.5 px-4 py-3">
          <Text variant="footnote" tone="destructive">
            Can't connect — its bb agent is out of date
          </Text>
          <Text variant="caption">Usually it updates itself.</Text>
          {daemonStatus ? <Text variant="caption">{daemonStatus}</Text> : null}
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
      <SettingsSection
        title="Skills"
        footnote={cliSkillsInstallDescription(hasConnectedMachine)}
      >
        <SettingsControlRow
          label={CLI_SKILLS_SETTING_LABEL}
          tag={summarizeMachineStatuses([...statuses.values()]) ?? undefined}
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
  const checkForUpdates = () => check.mutate(connectedHostIds);
  const bbAppState = bbAppRowState(inventory.systemVersion);

  return (
    <>
      {IS_IOS ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="arrow.clockwise"
            accessibilityLabel="Check for updates"
            disabled={check.isPending}
            onPress={checkForUpdates}
          />
          <Stack.Toolbar.Menu
            icon="ellipsis.circle"
            accessibilityLabel="More updates actions"
          >
            <Stack.Toolbar.MenuAction icon="doc.text" onPress={openChangelog}>
              What's new
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon="arrow.clockwise"
              disabled={check.isPending}
              onPress={checkForUpdates}
            >
              Check for updates
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : null}
      <GroupedScreen testID="updates-screen">
        <SettingsSection
          title="bb"
          action={
            IS_IOS ? undefined : (
              <View className="flex-row items-center gap-4">
                <HeaderIconButton
                  icon="RotateCcw"
                  accessibilityLabel="Check for updates"
                  loading={check.isPending}
                  onPress={checkForUpdates}
                  testID="updates-check"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={openChangelog}
                  testID="updates-whats-new"
                >
                  What's new
                </Button>
              </View>
            )
          }
          footnote={
            <View className="gap-1">
              <Text variant="footnote" tone="muted">
                Connected machines follow the server version automatically.
              </Text>
              {check.isPending || checkedLabel !== null ? (
                <Text
                  variant="footnote"
                  tone="muted"
                  testID="updates-checked-label"
                >
                  {check.isPending ? "Checking…" : checkedLabel}
                </Text>
              ) : null}
            </View>
          }
        >
          <BbAppRow state={bbAppState} />
          {bbAppState.kind === "available" ? (
            <GroupedRow
              title="Copy upgrade command"
              subtitle={bbAppState.upgradeCommand}
              leading="Copy"
              leadingTone="primary"
              onPress={() => copyUpgradeCommand(bbAppState.upgradeCommand)}
              testID="updates-copy-upgrade"
            />
          ) : null}
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
            <View className="px-4 py-3">
              <Text variant="footnote" tone="muted">
                {inventory.isLoading ? "Loading…" : "No machines yet."}
              </Text>
            </View>
          ) : (
            inventory.machines.map((machine) => (
              <MachineUpdatesBlock
                key={machine.host.id}
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
            ))
          )}
        </SettingsSection>

        <CliSkillsSection hosts={hosts} />
      </GroupedScreen>
      <ProviderCliInstallLogHost runner={runner} />
    </>
  );
}
