import type { Host } from "@bb/domain";
import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { useProfiles } from "@/app-shell";
import {
  countProjectsByHost,
  HOST_PLATFORM_LABELS,
  hostCanRetryUpdate,
  MACHINES_SECTION_DESCRIPTION,
  machineMetaLine,
  PERMISSION_MODE_SHORT_LABELS,
  PRIMARY_HOST_REMOVE_DISABLED_REASON,
  useHosts,
  useAddMachineSession,
  useRemoveHost,
  useRenameHost,
  useRetryHostUpdate,
  useServerProtocolVersion,
} from "@/data/hosts";
import { useSidebarBootstrap } from "@/data/sidebar";
import { useSystemConfig } from "@/data/system";
import { haptic } from "@/lib/haptics";
import {
  ActionSheet,
  confirmDestructive,
  EmptyStatePanel,
  GroupedRow,
  Spinner,
  Text,
  toast,
  useSheet,
  type ActionSheetAction,
} from "@/ui";
import { HostStatusDot } from "../pickers";
import { GroupedScreen } from "../settings/GroupedScreen";
import { LinkRow } from "../settings/LinkRow";
import { HeaderIconButton, SettingsSection } from "../settings/SettingsRows";
import { machineDetailHref } from "../shell/hrefs";
import { useNow } from "../shell/use-now";
import { AddMachineSheet } from "./AddMachineSheet";
import { MachineRenameSheet } from "./MachineRenameSheet";
import { promptRenameMachine } from "./rename-machine-prompt";

const IS_IOS = process.env.EXPO_OS === "ios";

/**
 * `/settings/machines` (web MachinesSettingsSection): every paired machine
 * with its presence, platform, project count and permission limit; tap
 * opens the detail screen, long-press the row's action sheet (rename /
 * retry / remove) on both platforms, "+" the pairing sheet.
 */
export function MachinesScreen() {
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <GroupedScreen testID="machines-screen">
        <EmptyStatePanel>Add a server first.</EmptyStatePanel>
      </GroupedScreen>
    );
  }
  return <ConnectedMachinesScreen />;
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}

/** Presents the Android rename sheet after the menu sheet has left the modal host. */
const SHEET_HANDOFF_MS = 250;

function ConnectedMachinesScreen() {
  const router = useRouter();
  const hostsQuery = useHosts();
  const configQuery = useSystemConfig();
  const bootstrap = useSidebarBootstrap();
  const serverProtocolVersion = useServerProtocolVersion();
  const removeHost = useRemoveHost();
  const renameHost = useRenameHost();
  const retryUpdate = useRetryHostUpdate();

  const hosts = hostsQuery.data;
  const primaryHostId = configQuery.data?.primaryHostId ?? null;
  const projectCounts = useMemo(
    () => countProjectsByHost(bootstrap.data?.projects ?? []),
    [bootstrap.data?.projects],
  );
  const primaryPlatform = configQuery.data?.primaryHostPlatform ?? null;
  const now = useNow();

  const addSheet = useSheet();
  const addSession = useAddMachineSession();
  const openAddMachine = () => {
    addSession.begin();
    addSheet.present();
  };
  const menu = useSheet();
  const renameSheet = useSheet();
  const [target, setTarget] = useState<Host | null>(null);

  const rename = (host: Host, fromMenu = false) => {
    const handled = promptRenameMachine({
      currentName: host.name,
      onSubmit: (name) =>
        renameHost.mutate(
          { hostId: host.id, name },
          {
            onSuccess: (updated) => toast.success(`Renamed to ${updated.name}`),
            onError: (error) =>
              toast.error(`Couldn't rename ${host.name}`, {
                description: describeError(
                  error,
                  "The server refused the request.",
                ),
              }),
          },
        ),
    });
    if (handled) return;
    setTarget(host);
    if (fromMenu) setTimeout(() => renameSheet.present(), SHEET_HANDOFF_MS);
    else renameSheet.present();
  };

  const confirmRemove = (host: Host) =>
    confirmDestructive({
      title: `Remove ${host.name}?`,
      message: `This revokes ${host.name}'s access to this server. Project checkouts stay on its disk, but its environments become read-only history and it can't run new work until it's paired again.`,
      actionLabel: "Remove machine",
      onConfirm: () => {
        const name = host.name;
        removeHost.mutate(host.id, {
          onSuccess: () => toast.success(`Removed ${name}`),
          onError: (error) =>
            toast.error(`Couldn't remove ${name}`, {
              description: describeError(
                error,
                "The server refused the request.",
              ),
            }),
        });
      },
    });

  const actionsFor = (host: Host): ActionSheetAction[] => {
    const isPrimary = host.id === primaryHostId;
    return [
      {
        key: "open",
        label: "Open",
        icon: "ChevronRight",
        onPress: () => router.push(machineDetailHref(host.id)),
      },
      {
        key: "rename",
        label: "Rename",
        icon: "Edit",
        onPress: () => rename(host, true),
      },
      ...(hostCanRetryUpdate(host, serverProtocolVersion)
        ? [
            {
              key: "retry",
              label: "Retry update",
              icon: "RotateCcw" as const,
              onPress: () => {
                retryUpdate.mutate(host.id, {
                  onSuccess: () =>
                    toast.success(`Update retry requested for ${host.name}`),
                });
              },
            },
          ]
        : []),
      {
        key: "remove",
        label: "Remove machine",
        subtitle: isPrimary ? PRIMARY_HOST_REMOVE_DISABLED_REASON : undefined,
        icon: "Trash2",
        destructive: true,
        disabled: isPrimary,
        onPress: () => confirmRemove(host),
      },
    ];
  };

  const openMenu = (host: Host) => {
    haptic("impact-heavy");
    setTarget(host);
    menu.present();
  };

  return (
    <>
      {IS_IOS ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="plus"
            accessibilityLabel="Add a machine"
            onPress={openAddMachine}
          />
        </Stack.Toolbar>
      ) : (
        <Stack.Screen
          options={{
            headerRight: () => (
              <HeaderIconButton
                icon="Plus"
                accessibilityLabel="Add a machine"
                onPress={openAddMachine}
                testID="machines-add"
              />
            ),
          }}
        />
      )}
      <GroupedScreen testID="machines-screen">
        <SettingsSection
          title="Machines"
          footnote={`${MACHINES_SECTION_DESCRIPTION} Tap a machine for its permission limit, provider CLIs and updates${IS_IOS ? "." : "; long-press for rename and remove."}`}
        >
          {hosts === undefined ? (
            <View className="items-center px-4 py-6">
              <Spinner />
            </View>
          ) : hosts.length === 0 ? (
            <View className="px-4 py-3">
              <Text variant="footnote" tone="muted">
                No machines yet.
              </Text>
            </View>
          ) : (
            hosts.map((host) => {
              const isPrimary = host.id === primaryHostId;
              return (
                <LinkRow
                  key={host.id}
                  href={machineDetailHref(host.id)}
                  title={host.name}
                  subtitle={`${hosts.length > 1 && isPrimary ? "Primary · " : ""}${machineMetaLine(
                    {
                      host,
                      platformLabel:
                        isPrimary && primaryPlatform !== null
                          ? HOST_PLATFORM_LABELS[primaryPlatform]
                          : null,
                      projectCount: projectCounts.get(host.id) ?? 0,
                      serverProtocolVersion,
                      now,
                    },
                  )}`}
                  leading={
                    <View className="w-5 items-center">
                      <HostStatusDot connected={host.status === "connected"} />
                    </View>
                  }
                  value={PERMISSION_MODE_SHORT_LABELS[host.maxPermissionMode]}
                  onLongPress={() => openMenu(host)}
                  testID={`machine-row-${host.id}`}
                />
              );
            })
          )}
          <GroupedRow
            title="Add a machine…"
            leading="Plus"
            leadingTone="primary"
            onPress={openAddMachine}
            testID="machines-add-button"
          />
        </SettingsSection>
      </GroupedScreen>

      <AddMachineSheet controller={addSheet} session={addSession} />

      <ActionSheet
        controller={menu}
        title={target?.name}
        actions={target ? actionsFor(target) : []}
      />

      <MachineRenameSheet controller={renameSheet} host={target} />
    </>
  );
}
