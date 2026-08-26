import type { PermissionMode } from "@bb/domain";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
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
  useRenameHost,
  useRetryHostUpdate,
  useServerProtocolVersion,
  useUpdateHostPermissionCeiling,
} from "@/data/hosts";
import { useSidebarBootstrap } from "@/data/sidebar";
import { useSystemConfig } from "@/data/system";
import {
  Button,
  confirmDestructive,
  EmptyStatePanel,
  GroupedRow,
  Spinner,
  Text,
  toast,
  useSheet,
  type IconName,
} from "@/ui";
import { HostStatusDot } from "../pickers";
import { GroupedScreen } from "../settings/GroupedScreen";
import { LinkRow } from "../settings/LinkRow";
import { MenuValueRow } from "../settings/MenuValueRow";
import {
  HeaderIconButton,
  ICON_ROW_SEPARATOR_INSET,
  SettingsControlRow,
  SettingsSection,
  SettingsValueRow,
} from "../settings/SettingsRows";
import { firstParam, projectSettingsHref } from "../shell/hrefs";
import { useNow } from "../shell/use-now";
import { MachineRenameSheet } from "./MachineRenameSheet";
import { ProviderCliInstallLogHost, ProviderCliRows } from "./ProviderCliRows";
import { promptRenameMachine } from "./rename-machine-prompt";

const IS_IOS = process.env.EXPO_OS === "ios";

const PERMISSION_MODE_ICON: Record<PermissionMode, IconName> = {
  "accept-edits": "EditFile",
  auto: "CircleCheck",
  full: "Zap",
};

/**
 * `/settings/machines/[hostId]` (web MachineSettingsView): presence /
 * platform / pairing age, rename, the permission ceiling, the projects with
 * a source here, provider CLIs with Install / Update, the daemon update
 * retry, and Remove. Rename and the overflow menu live in the header.
 */
export function MachineDetailScreen() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>();
  const hostId = firstParam(params.hostId);
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <GroupedScreen testID="machine-detail-screen">
        <EmptyStatePanel>Add a server first.</EmptyStatePanel>
      </GroupedScreen>
    );
  }
  return <ConnectedMachineDetailScreen hostId={hostId} />;
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}

function ConnectedMachineDetailScreen({ hostId }: { hostId: string }) {
  const router = useRouter();
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
  const renameHost = useRenameHost();
  const renameSheet = useSheet();
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
      <GroupedScreen scroll={false} testID="machine-detail-screen">
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      </GroupedScreen>
    );
  }
  if (host === null) {
    return (
      <GroupedScreen testID="machine-detail-screen">
        <EmptyStatePanel>Machine is no longer paired.</EmptyStatePanel>
        <Button variant="outline" onPress={() => router.back()}>
          Back to machines
        </Button>
      </GroupedScreen>
    );
  }

  const platformLabel =
    isPrimary && configQuery.data?.primaryHostPlatform
      ? HOST_PLATFORM_LABELS[configQuery.data.primaryHostPlatform]
      : null;
  const updateStatus = formatHostUpdateStatus(host, serverProtocolVersion);
  const canRetry = hostCanRetryUpdate(host, serverProtocolVersion);

  const rename = () => {
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
    setRenaming(true);
    renameSheet.present();
  };

  const retry = () =>
    retryUpdate.mutate(host.id, {
      onSuccess: () => toast.success(`Update retry requested for ${host.name}`),
    });

  const confirmRemove = () =>
    confirmDestructive({
      title: `Remove ${host.name}?`,
      message: `This revokes ${host.name}'s access to this server. Project checkouts stay on its disk, but its environments become read-only history and it can't run new work until it's paired again.`,
      actionLabel: "Remove machine",
      onConfirm: () => {
        const name = host.name;
        removeHost.mutate(host.id, {
          onSuccess: () => {
            toast.success(`Removed ${name}`);
            router.back();
          },
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

  const selectCeiling = (maxPermissionMode: PermissionMode) => {
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
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: host.name,
          ...(IS_IOS
            ? {}
            : {
                headerRight: () => (
                  <HeaderIconButton
                    icon="Edit"
                    accessibilityLabel="Rename machine"
                    onPress={rename}
                    testID="machine-rename"
                  />
                ),
              }),
        }}
      />
      {IS_IOS ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="pencil"
            accessibilityLabel="Rename machine"
            onPress={rename}
          />
          <Stack.Toolbar.Menu
            icon="ellipsis.circle"
            accessibilityLabel="Machine actions"
          >
            <Stack.Toolbar.MenuAction icon="pencil" onPress={rename}>
              Rename
            </Stack.Toolbar.MenuAction>
            {online ? (
              <Stack.Toolbar.MenuAction
                icon="arrow.clockwise"
                disabled={statusQuery.isFetching}
                onPress={() => void statusQuery.refetch()}
              >
                Recheck provider CLIs
              </Stack.Toolbar.MenuAction>
            ) : null}
            {canRetry ? (
              <Stack.Toolbar.MenuAction
                icon="arrow.triangle.2.circlepath"
                disabled={retryUpdate.isPending}
                onPress={retry}
              >
                Retry update
              </Stack.Toolbar.MenuAction>
            ) : null}
            <Stack.Toolbar.MenuAction
              icon="trash"
              destructive
              disabled={isPrimary || removeHost.isPending}
              onPress={confirmRemove}
            >
              Remove machine
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : null}
      <GroupedScreen testID="machine-detail-screen">
        <SettingsSection
          title="Machine"
          separatorInset={ICON_ROW_SEPARATOR_INSET}
          footnote={machineHeaderMeta({ host, platformLabel, now })}
        >
          <View className="min-h-[44px] flex-row items-center gap-3 px-4 py-2.5">
            <View className="w-5 items-center">
              <HostStatusDot connected={online} />
            </View>
            <Text
              variant="bodyLarge"
              numberOfLines={1}
              className="min-w-0 flex-1"
              selectable
              testID="machine-detail-name"
            >
              {host.name}
            </Text>
            <Text variant="bodyLarge" tone="muted">
              {hosts.length > 1 && isPrimary
                ? "Primary"
                : online
                  ? "Online"
                  : "Offline"}
            </Text>
          </View>
          <GroupedRow
            title="Rename machine"
            leading="Edit"
            trailing="chevron"
            onPress={rename}
            testID="machine-rename-row"
          />
        </SettingsSection>

        <SettingsSection
          title="Permission limit"
          footnote={PERMISSION_LIMIT_DESCRIPTION}
        >
          <MenuValueRow
            title="Highest permission mode"
            subtitle={updateCeiling.isPending ? "Saving…" : undefined}
            value={PERMISSION_MODE_SHORT_LABELS[host.maxPermissionMode]}
            options={permissionOptions.map((option) => ({
              value: option.value,
              label: option.label,
              icon: PERMISSION_MODE_ICON[option.value],
              disabled: option.disabled,
            }))}
            selected={host.maxPermissionMode}
            onSelect={selectCeiling}
            disabled={updateCeiling.isPending}
            testID="machine-permission-ceiling"
            accessibilityLabel="Permission mode"
          />
        </SettingsSection>

        <SettingsSection title={`Projects on ${host.name}`}>
          {projects.length === 0 ? (
            <SettingsValueRow label="Projects" value="None" />
          ) : (
            projects.map((project) => (
              <LinkRow
                key={project.id}
                href={projectSettingsHref(project.id)}
                title={project.name}
                leading="Folder"
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
              canRetry ? (
                <Button
                  size="sm"
                  variant="outline"
                  loading={retryUpdate.isPending}
                  onPress={retry}
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
            online && !IS_IOS ? (
              <HeaderIconButton
                icon="RotateCcw"
                accessibilityLabel="Recheck provider CLIs"
                loading={statusQuery.isFetching}
                onPress={() => void statusQuery.refetch()}
                testID="machine-provider-clis-refresh"
              />
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
          footnote={
            isPrimary
              ? PRIMARY_HOST_REMOVE_DISABLED_REASON
              : `Revokes ${host.name}'s access to this server. Project checkouts stay on its disk.`
          }
        >
          <GroupedRow
            title="Remove machine"
            leading="Trash2"
            destructive
            disabled={isPrimary || removeHost.isPending}
            onPress={confirmRemove}
            testID="machine-remove"
          />
        </SettingsSection>
      </GroupedScreen>

      <MachineRenameSheet
        controller={renameSheet}
        host={renaming ? host : null}
        onRenamed={() => setRenaming(false)}
      />
      <ProviderCliInstallLogHost runner={runner} />
    </>
  );
}
