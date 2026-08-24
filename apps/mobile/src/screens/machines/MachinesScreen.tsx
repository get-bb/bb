import type { Host } from "@bb/domain";
import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
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
  useRetryHostUpdate,
  useServerProtocolVersion,
} from "@/data/hosts";
import { useSidebarBootstrap } from "@/data/sidebar";
import { useSystemConfig } from "@/data/system";
import { useTheme } from "@/theme";
import {
  ActionSheet,
  Button,
  EmptyStatePanel,
  Icon,
  ListRow,
  Pill,
  Spinner,
  Text,
  toast,
  useSheet,
} from "@/ui";
import { HostStatusDot } from "../pickers";
import { SettingsSection } from "../settings/SettingsRows";
import { machineDetailHref } from "../shell/hrefs";
import { Screen } from "../shell/Screen";
import { useNow } from "../shell/use-now";
import { AddMachineSheet } from "./AddMachineSheet";
import { MachineRenameSheet } from "./MachineRenameSheet";

/**
 * `/settings/machines` (web MachinesSettingsSection): every paired machine
 * with its presence, platform, project count and permission limit; tap
 * opens the detail screen, long-press the rename / retry / remove menu,
 * "+" the pairing sheet.
 */
export function MachinesScreen() {
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <Screen testID="machines-screen">
        <EmptyStatePanel>Add a server first.</EmptyStatePanel>
      </Screen>
    );
  }
  return <ConnectedMachinesScreen />;
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}

function ConnectedMachinesScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const hostsQuery = useHosts();
  const configQuery = useSystemConfig();
  const bootstrap = useSidebarBootstrap();
  const serverProtocolVersion = useServerProtocolVersion();
  const removeHost = useRemoveHost();
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
  const removeConfirm = useSheet();
  const [target, setTarget] = useState<Host | null>(null);
  const targetIsPrimary = target !== null && target.id === primaryHostId;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a machine"
              hitSlop={8}
              onPress={openAddMachine}
              testID="machines-add"
            >
              <Icon name="Plus" size={22} color={tokens.foreground} />
            </Pressable>
          ),
        }}
      />
      <Screen testID="machines-screen">
        <SettingsSection
          title="Machines"
          description={MACHINES_SECTION_DESCRIPTION}
        >
          {hosts === undefined ? (
            <View className="items-center px-4 py-6">
              <Spinner />
            </View>
          ) : hosts.length === 0 ? (
            <View className="px-4 py-4">
              <Text variant="caption">No machines yet.</Text>
            </View>
          ) : (
            hosts.map((host) => {
              const isPrimary = host.id === primaryHostId;
              return (
                <ListRow
                  key={host.id}
                  title={host.name}
                  titleLines={1}
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
                  trailing={
                    <View className="flex-row items-center gap-2">
                      <Pill variant="secondary" size="sm">
                        {PERMISSION_MODE_SHORT_LABELS[host.maxPermissionMode]}
                      </Pill>
                      <Icon
                        name="ChevronRight"
                        size={18}
                        color={tokens.subtleForeground}
                      />
                    </View>
                  }
                  onPress={() => router.push(machineDetailHref(host.id))}
                  onLongPress={() => {
                    setTarget(host);
                    menu.present();
                  }}
                  testID={`machine-row-${host.id}`}
                />
              );
            })
          )}
        </SettingsSection>
        <Button
          variant="outline"
          icon="Plus"
          onPress={openAddMachine}
          testID="machines-add-button"
        >
          Add a machine
        </Button>
        <Text variant="caption">
          Tap a machine for its permission limit, provider CLIs and updates.
          Long-press for rename and remove.
        </Text>
      </Screen>

      <AddMachineSheet controller={addSheet} session={addSession} />

      <ActionSheet
        controller={menu}
        title={target?.name}
        actions={[
          {
            key: "open",
            label: "Open",
            icon: "ChevronRight",
            onPress: () => {
              if (target) router.push(machineDetailHref(target.id));
            },
          },
          {
            key: "rename",
            label: "Rename",
            icon: "Edit",
            onPress: () => {
              setTimeout(() => renameSheet.present(), 250);
            },
          },
          ...(target && hostCanRetryUpdate(target, serverProtocolVersion)
            ? [
                {
                  key: "retry",
                  label: "Retry update",
                  icon: "RotateCcw" as const,
                  onPress: () => {
                    retryUpdate.mutate(target.id, {
                      onSuccess: () =>
                        toast.success(
                          `Update retry requested for ${target.name}`,
                        ),
                    });
                  },
                },
              ]
            : []),
          {
            key: "remove",
            label: targetIsPrimary
              ? `Remove machine — ${PRIMARY_HOST_REMOVE_DISABLED_REASON}`
              : "Remove machine",
            icon: "Trash2",
            destructive: true,
            disabled: targetIsPrimary,
            onPress: () => {
              setTimeout(() => removeConfirm.present(), 250);
            },
          },
        ]}
      />

      <MachineRenameSheet controller={renameSheet} host={target} />

      <ActionSheet
        controller={removeConfirm}
        title={target ? `Remove ${target.name}?` : "Remove machine?"}
        message={
          target
            ? `This revokes ${target.name}'s access to this server. Project checkouts stay on its disk, but its environments become read-only history and it can't run new work until it's paired again.`
            : undefined
        }
        actions={[
          {
            key: "confirm",
            label: "Remove machine",
            icon: "Trash2",
            destructive: true,
            onPress: () => {
              if (!target) return;
              const name = target.name;
              removeHost.mutate(target.id, {
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
          },
        ]}
      />
    </>
  );
}
