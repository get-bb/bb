import type { PermissionMode } from "@bb/domain";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useProfiles } from "@/app-shell";
import { buildPermissionModeOptions } from "@/data/compose";
import {
  formatHostUpdateStatus,
  HOST_PLATFORM_LABELS,
  hostCanRetryUpdate,
  machineHeaderMeta,
  PERMISSION_LIMIT_DESCRIPTION,
  PERMISSION_MODE_SHORT_LABELS,
  PRIMARY_HOST_REMOVE_DISABLED_REASON,
  providerCliIssues,
  useHostProviderCliStatus,
  useHosts,
  useProviderCliInstallRunner,
  useRemoveHost,
  useRetryHostUpdate,
  useServerProtocolVersion,
  useUpdateHostPermissionCeiling,
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
import { HostStatusDot, PermissionModePicker } from "../pickers";
import {
  SettingsControlRow,
  SettingsSection,
  SettingsValueRow,
} from "../settings/SettingsRows";
import { firstParam, projectSettingsHref } from "../shell/hrefs";
import { Screen } from "../shell/Screen";
import { useNow } from "../shell/use-now";
import { MachineRenameSheet } from "./MachineRenameSheet";
import { ProviderCliInstallLogHost, ProviderCliRows } from "./ProviderCliRows";

/**
 * `/settings/machines/[hostId]` (web MachineSettingsView): presence /
 * platform / pairing age, rename, the permission ceiling, the projects with
 * a source here, provider CLIs with Install / Update, the daemon update
 * retry, and Remove.
 */
export function MachineDetailScreen() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>();
  const hostId = firstParam(params.hostId);
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <Screen testID="machine-detail-screen">
        <EmptyStatePanel>Add a server first.</EmptyStatePanel>
      </Screen>
    );
  }
  return <ConnectedMachineDetailScreen hostId={hostId} />;
}

function ConnectedMachineDetailScreen({ hostId }: { hostId: string }) {
  const router = useRouter();
  const { tokens } = useTheme();
  const hostsQuery = useHosts();
  const configQuery = useSystemConfig();
  const bootstrap = useSidebarBootstrap();
  const hosts = hostsQuery.data;
  const host = hosts?.find((candidate) => candidate.id === hostId) ?? null;
  const primaryHostId = configQuery.data?.primaryHostId ?? null;
  const isPrimary = host !== null && host.id === primaryHostId;
  const online = host?.status === "connected";

  const statusQuery = useHostProviderCliStatus(online ? hostId : null);
  const serverProtocolVersion = useServerProtocolVersion();
  const runner = useProviderCliInstallRunner();
  const updateCeiling = useUpdateHostPermissionCeiling();
  const retryUpdate = useRetryHostUpdate();
  const removeHost = useRemoveHost();
  const renameSheet = useSheet();
  const removeConfirm = useSheet();
  const [renaming, setRenaming] = useState(false);
  const now = useNow();

  const projects = useMemo(
    () =>
      (bootstrap.data?.projects ?? []).filter((project) =>
        project.sources.some((source) => source.hostId === hostId),
      ),
    [bootstrap.data?.projects, hostId],
  );
  const permissionOptions = useMemo(
    () =>
      buildPermissionModeOptions({
        permissionModes: undefined,
        ceiling: "full",
      }),
    [],
  );
  const issues = useMemo(
    () => (statusQuery.data ? providerCliIssues(statusQuery.data) : []),
    [statusQuery.data],
  );

  if (hosts === undefined) {
    return (
      <Screen scroll={false} testID="machine-detail-screen">
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      </Screen>
    );
  }
  if (host === null) {
    return (
      <Screen testID="machine-detail-screen">
        <EmptyStatePanel>Machine is no longer paired.</EmptyStatePanel>
        <Button variant="outline" onPress={() => router.back()}>
          Back to machines
        </Button>
      </Screen>
    );
  }

  const platformLabel =
    isPrimary && configQuery.data?.primaryHostPlatform
      ? HOST_PLATFORM_LABELS[configQuery.data.primaryHostPlatform]
      : null;
  const updateStatus = formatHostUpdateStatus(host, serverProtocolVersion);

  return (
    <>
      <Stack.Screen
        options={{
          title: host.name,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Rename machine"
              hitSlop={8}
              onPress={() => {
                setRenaming(true);
                renameSheet.present();
              }}
              testID="machine-rename"
            >
              <Icon name="Edit" size={20} color={tokens.foreground} />
            </Pressable>
          ),
        }}
      />
      <Screen testID="machine-detail-screen">
        <View className="gap-1">
          <View className="flex-row items-center gap-2">
            <HostStatusDot connected={online} />
            <Text
              variant="title"
              numberOfLines={1}
              className="shrink"
              testID="machine-detail-name"
            >
              {host.name}
            </Text>
            {hosts.length > 1 && isPrimary ? (
              <Pill variant="outline" size="sm">
                Primary
              </Pill>
            ) : null}
          </View>
          <Text variant="caption">
            {machineHeaderMeta({ host, platformLabel, now })}
          </Text>
        </View>

        <SettingsSection title="Machine">
          <ListRow
            title="Rename machine"
            subtitle={host.name}
            leading="Edit"
            trailing="chevron"
            onPress={() => {
              setRenaming(true);
              renameSheet.present();
            }}
            testID="machine-rename-row"
          />
        </SettingsSection>

        <SettingsSection
          title="Permission limit"
          description={PERMISSION_LIMIT_DESCRIPTION}
        >
          <SettingsControlRow
            label="Highest permission mode"
            description={updateCeiling.isPending ? "Saving…" : undefined}
            control={
              <PermissionModePicker
                options={permissionOptions}
                value={host.maxPermissionMode}
                disabled={updateCeiling.isPending}
                onChange={(maxPermissionMode: PermissionMode) => {
                  if (maxPermissionMode === host.maxPermissionMode) return;
                  updateCeiling.mutate(
                    { hostId: host.id, maxPermissionMode },
                    {
                      onSuccess: () =>
                        toast.success(
                          `${host.name} limited to ${PERMISSION_MODE_SHORT_LABELS[maxPermissionMode]}`,
                        ),
                    },
                  );
                }}
                testID="machine-permission-ceiling"
              />
            }
          />
        </SettingsSection>

        <SettingsSection title={`Projects on ${host.name}`}>
          {projects.length === 0 ? (
            <SettingsValueRow label="Projects" value="None" />
          ) : (
            projects.map((project) => (
              <ListRow
                key={project.id}
                title={project.name}
                leading="Folder"
                trailing="chevron"
                onPress={() => router.push(projectSettingsHref(project.id))}
                testID={`machine-project-${project.id}`}
              />
            ))
          )}
        </SettingsSection>

        <SettingsSection title="bb agent">
          <SettingsControlRow
            label="Updates"
            description={updateStatus ?? "Up to date"}
            control={
              hostCanRetryUpdate(host, serverProtocolVersion) ? (
                <Button
                  size="sm"
                  variant="outline"
                  loading={retryUpdate.isPending}
                  onPress={() =>
                    retryUpdate.mutate(host.id, {
                      onSuccess: () =>
                        toast.success(
                          `Update retry requested for ${host.name}`,
                        ),
                    })
                  }
                  testID="machine-retry-update"
                >
                  Retry update
                </Button>
              ) : undefined
            }
          />
        </SettingsSection>

        <SettingsSection
          title="Provider CLIs"
          action={
            online ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Recheck provider CLIs"
                hitSlop={8}
                disabled={statusQuery.isFetching}
                onPress={() => void statusQuery.refetch()}
                testID="machine-provider-clis-refresh"
              >
                {statusQuery.isFetching ? (
                  <Spinner size="small" color={tokens.mutedForeground} />
                ) : (
                  <Icon
                    name="RotateCcw"
                    size={18}
                    color={tokens.mutedForeground}
                  />
                )}
              </Pressable>
            ) : undefined
          }
        >
          <ProviderCliRows
            host={host}
            status={statusQuery.data ?? null}
            statusPending={statusQuery.isPending}
            statusError={statusQuery.isError}
            issues={issues}
            runner={runner}
            testIDPrefix="machine-provider-cli"
          />
        </SettingsSection>

        <SettingsSection
          title="Danger zone"
          description={
            isPrimary
              ? PRIMARY_HOST_REMOVE_DISABLED_REASON
              : `Revokes ${host.name}'s access to this server. Project checkouts stay on its disk.`
          }
        >
          <ListRow
            title="Remove machine"
            leading="Trash2"
            destructive
            disabled={isPrimary || removeHost.isPending}
            onPress={removeConfirm.present}
            testID="machine-remove"
          />
        </SettingsSection>
      </Screen>

      <MachineRenameSheet
        controller={renameSheet}
        host={renaming ? host : null}
        onRenamed={() => setRenaming(false)}
      />
      <ProviderCliInstallLogHost runner={runner} />
      <ActionSheet
        controller={removeConfirm}
        title={`Remove ${host.name}?`}
        message={`This revokes ${host.name}'s access to this server. Project checkouts stay on its disk, but its environments become read-only history and it can't run new work until it's paired again.`}
        actions={[
          {
            key: "confirm",
            label: "Remove machine",
            icon: "Trash2",
            destructive: true,
            onPress: () => {
              const name = host.name;
              removeHost.mutate(host.id, {
                onSuccess: () => {
                  toast.success(`Removed ${name}`);
                  router.back();
                },
                onError: (error) =>
                  toast.error(`Couldn't remove ${name}`, {
                    description:
                      error instanceof Error && error.message.length > 0
                        ? error.message
                        : "The server refused the request.",
                  }),
              });
            },
          },
        ]}
      />
    </>
  );
}
