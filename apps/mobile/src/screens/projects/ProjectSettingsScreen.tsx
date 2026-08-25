import type { Host, ProjectSource } from "@bb/domain";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { useProfiles } from "@/app-shell";
import { useHosts } from "@/data/hosts";
import {
  useDeleteProject,
  useRemoveProjectSource,
  useRenameProject,
} from "@/data/projects";
import { useSidebarBootstrap, useSidebarProject } from "@/data/sidebar";
import { useTheme } from "@/theme";
import {
  ActionSheet,
  Button,
  confirmDestructive,
  EmptyStatePanel,
  GroupedRow,
  Icon,
  Input,
  ListRow,
  Sheet,
  Spinner,
  Text,
  toast,
  useSheet,
  type ActionSheetAction,
} from "@/ui";
import { HostStatusDot } from "../pickers";
import { GroupedScreen } from "../settings/GroupedScreen";
import {
  ICON_ROW_SEPARATOR_INSET,
  SettingsSection,
} from "../settings/SettingsRows";
import { firstParam } from "../shell/hrefs";
import {
  ProjectMachineSetupSheet,
  type ProjectMachineSetupTarget,
} from "./ProjectMachineSetupSheet";

const IS_IOS = process.env.EXPO_OS === "ios";

/**
 * `/projects/[id]/settings`: rename, the project's sources per machine
 * (add through the guided clone/folder flow, remove with confirmation), and
 * delete. Mirrors the web ProjectSettingsView essentials as grouped forms.
 */
export function ProjectSettingsScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const projectId = firstParam(params.id);
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <GroupedScreen testID="project-settings-screen">
        <EmptyStatePanel>Add a server first.</EmptyStatePanel>
      </GroupedScreen>
    );
  }
  return <ConnectedProjectSettingsScreen projectId={projectId} />;
}

function ConnectedProjectSettingsScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const bootstrap = useSidebarBootstrap();
  const project = useSidebarProject(projectId);
  const hostsQuery = useHosts();
  const hosts = useMemo(() => hostsQuery.data ?? [], [hostsQuery.data]);
  const hostById = useMemo(
    () => new Map(hosts.map((host) => [host.id, host])),
    [hosts],
  );
  const renameProject = useRenameProject();
  const removeSource = useRemoveProjectSource();
  const deleteProject = useDeleteProject();

  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const name = nameDraft ?? project?.name ?? "";
  const nameDirty = nameDraft !== null && nameDraft.trim() !== project?.name;

  const sourceMenu = useSheet();
  const [sourceForMenu, setSourceForMenu] = useState<ProjectSource | null>(
    null,
  );
  const addHostSheet = useSheet();
  const setupSheet = useSheet();
  const [setupTarget, setSetupTarget] =
    useState<ProjectMachineSetupTarget | null>(null);

  if (bootstrap.isLoading && !project) {
    return (
      <GroupedScreen scroll={false} testID="project-settings-screen">
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      </GroupedScreen>
    );
  }
  if (!project) {
    return (
      <GroupedScreen testID="project-settings-screen">
        <EmptyStatePanel>This project no longer exists.</EmptyStatePanel>
        <Button variant="outline" onPress={() => router.back()}>
          Go back
        </Button>
      </GroupedScreen>
    );
  }
  const isPersonal = project.kind === "personal";
  const sourceHostIds = new Set(project.sources.map((source) => source.hostId));
  const addableHosts = hosts.filter((host) => !sourceHostIds.has(host.id));

  const saveName = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      toast.warning("Project name can't be empty.");
      return;
    }
    renameProject.mutate(
      { id: project.id, name: trimmed },
      {
        onSuccess: () => {
          setNameDraft(null);
          toast.success("Project renamed");
        },
      },
    );
  };

  const openSetupFor = (host: Host) => {
    setSetupTarget({
      projectId: project.id,
      projectName: project.name,
      gitRemoteUrl: project.gitRemoteUrl,
      hostId: host.id,
      hostName: host.name,
    });
    setupSheet.present();
  };

  const confirmRemoveSource = (source: ProjectSource) =>
    confirmDestructive({
      title: "Remove this source?",
      message: `bb stops using ${source.path} on ${hostById.get(source.hostId)?.name ?? "that machine"} for this project. The folder stays on disk.`,
      actionLabel: "Remove",
      onConfirm: () =>
        removeSource.mutate(
          { projectId: project.id, sourceId: source.id },
          { onSuccess: () => toast.success("Source removed") },
        ),
    });

  const sourceActions = (source: ProjectSource): ActionSheetAction[] => [
    {
      key: "remove",
      label: "Remove source",
      icon: "FolderMinus",
      destructive: true,
      onPress: () => confirmRemoveSource(source),
    },
  ];

  const confirmDelete = () =>
    confirmDestructive({
      title: `Delete ${project.name}?`,
      message:
        "This removes the project and all of its threads from bb. This cannot be undone.",
      actionLabel: "Delete project",
      onConfirm: () => {
        deleteProject.mutate(project.id, {
          onSuccess: () => {
            toast.success(`Deleted ${project.name}`);
            router.dismissTo("/");
          },
        });
      },
    });

  return (
    <GroupedScreen testID="project-settings-screen">
      <SettingsSection
        title="Name"
        footnote={project.gitRemoteUrl ?? undefined}
      >
        <View className="flex-row items-center gap-2 px-1">
          <Input
            value={name}
            onChangeText={setNameDraft}
            editable={!isPersonal && !renameProject.isPending}
            returnKeyType="done"
            onSubmitEditing={saveName}
            grouped
            className="flex-1"
            accessibilityLabel="Project name"
            testID="project-name-input"
          />
          {nameDirty ? (
            <Button
              size="sm"
              variant="ghost"
              loading={renameProject.isPending}
              onPress={saveName}
              testID="project-name-save"
            >
              Save
            </Button>
          ) : null}
        </View>
      </SettingsSection>

      {isPersonal ? (
        <Text variant="footnote" tone="muted" className="px-4">
          The personal project has no sources; its threads run in each machine's
          personal workspace.
        </Text>
      ) : (
        <SettingsSection
          title="Sources"
          separatorInset={ICON_ROW_SEPARATOR_INSET}
          footnote="Where this project is checked out. One folder per machine."
        >
          {project.sources.length === 0 ? (
            <View className="px-4 py-3">
              <Text variant="footnote" tone="muted">
                No sources yet.
              </Text>
            </View>
          ) : (
            project.sources.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                host={hostById.get(source.hostId)}
                onOpenMenu={() => {
                  setSourceForMenu(source);
                  sourceMenu.present();
                }}
              />
            ))
          )}
          <GroupedRow
            title="Add source…"
            subtitle={
              addableHosts.length === 0
                ? hosts.length === 0
                  ? "No machines connected"
                  : "Every machine already has a source"
                : "Clone or point at a folder on another machine"
            }
            leading="FolderPlus"
            leadingTone="primary"
            trailing="chevron"
            disabled={addableHosts.length === 0}
            onPress={addHostSheet.present}
            testID="project-add-source"
          />
        </SettingsSection>
      )}

      {isPersonal ? null : (
        <SettingsSection footnote="Deletes the project and every thread in it from bb. Files on your machines are left alone.">
          <GroupedRow
            title="Delete project"
            leading="Trash2"
            destructive
            disabled={deleteProject.isPending}
            onPress={confirmDelete}
            testID="project-delete"
          />
        </SettingsSection>
      )}

      <ActionSheet
        controller={sourceMenu}
        title={hostById.get(sourceForMenu?.hostId ?? "")?.name ?? "Source"}
        message={sourceForMenu?.path}
        actions={sourceForMenu ? sourceActions(sourceForMenu) : []}
      />
      <Sheet controller={addHostSheet} title="Add source on…" layout="scroll">
        {addableHosts.map((host) => (
          <ListRow
            key={host.id}
            title={host.name}
            subtitle={host.status === "connected" ? undefined : "Offline"}
            leading={
              <View className="w-5 items-center">
                <HostStatusDot connected={host.status === "connected"} />
              </View>
            }
            trailing="chevron"
            disabled={host.status !== "connected"}
            onPress={() => {
              addHostSheet.dismiss();
              openSetupFor(host);
            }}
            testID={`project-add-source-host-${host.id}`}
          />
        ))}
      </Sheet>
      <ProjectMachineSetupSheet
        controller={setupSheet}
        target={setupTarget}
        allowRemoteUrlEntry
        title={
          setupTarget
            ? `Add ${project.name} on ${setupTarget.hostName}`
            : undefined
        }
        onComplete={({ source }) =>
          toast.success("Source added", { description: source.path })
        }
      />
    </GroupedScreen>
  );
}

/**
 * One checkout: the machine, its path, and its action sheet on tap /
 * long-press. A plain row on both platforms: a native pull-down would hide
 * it from VoiceOver.
 */
function SourceRow({
  source,
  host,
  onOpenMenu,
}: {
  source: ProjectSource;
  host: Host | undefined;
  onOpenMenu: () => void;
}) {
  const { tokens } = useTheme();
  return (
    <GroupedRow
      title={host?.name ?? "Unknown machine"}
      subtitle={source.path}
      leading={
        <View className="w-5 items-center">
          <HostStatusDot connected={host?.status === "connected"} />
        </View>
      }
      trailing={
        <Icon
          name="MoreHorizontal"
          symbol="ellipsis.circle"
          size={IS_IOS ? 20 : 18}
          color={IS_IOS ? tokens.primary : tokens.subtleForeground}
        />
      }
      onPress={onOpenMenu}
      onLongPress={onOpenMenu}
      selectable
      testID={`project-source-${source.hostId}`}
    />
  );
}
