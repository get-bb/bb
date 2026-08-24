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
  EmptyStatePanel,
  Icon,
  Input,
  ListRow,
  Separator,
  Sheet,
  Spinner,
  Text,
  toast,
  useSheet,
} from "@/ui";
import { HostStatusDot } from "../pickers";
import { firstParam } from "../shell/hrefs";
import { Screen } from "../shell/Screen";
import {
  ProjectMachineSetupSheet,
  type ProjectMachineSetupTarget,
} from "./ProjectMachineSetupSheet";

/**
 * `/projects/[id]/settings`: rename, the project's sources per machine
 * (add through the guided clone/folder flow, remove with confirmation), and
 * delete. Mirrors the web ProjectSettingsView essentials.
 */
export function ProjectSettingsScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const projectId = firstParam(params.id);
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <Screen testID="project-settings-screen">
        <Text variant="title">Project settings</Text>
        <Text variant="caption">Add a server first.</Text>
      </Screen>
    );
  }
  return <ConnectedProjectSettingsScreen projectId={projectId} />;
}

function ConnectedProjectSettingsScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { tokens } = useTheme();
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
  const removeConfirm = useSheet();
  const [sourceForMenu, setSourceForMenu] = useState<ProjectSource | null>(
    null,
  );
  const addHostSheet = useSheet();
  const setupSheet = useSheet();
  const [setupTarget, setSetupTarget] =
    useState<ProjectMachineSetupTarget | null>(null);
  const deleteConfirm = useSheet();

  if (bootstrap.isLoading && !project) {
    return (
      <Screen scroll={false} testID="project-settings-screen">
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      </Screen>
    );
  }
  if (!project) {
    return (
      <Screen testID="project-settings-screen">
        <EmptyStatePanel>This project no longer exists.</EmptyStatePanel>
        <Button variant="outline" onPress={() => router.back()}>
          Go back
        </Button>
      </Screen>
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

  return (
    <Screen testID="project-settings-screen">
      <View className="gap-2">
        <Text variant="label">Name</Text>
        <View className="flex-row items-center gap-2">
          <Input
            value={name}
            onChangeText={setNameDraft}
            editable={!isPersonal && !renameProject.isPending}
            returnKeyType="done"
            onSubmitEditing={saveName}
            className="flex-1"
            testID="project-name-input"
          />
          {nameDirty ? (
            <Button
              size="default"
              loading={renameProject.isPending}
              onPress={saveName}
              testID="project-name-save"
            >
              Save
            </Button>
          ) : null}
        </View>
        {project.gitRemoteUrl ? (
          <Text variant="caption" numberOfLines={1}>
            {project.gitRemoteUrl}
          </Text>
        ) : null}
      </View>

      {isPersonal ? (
        <EmptyStatePanel>
          The personal project has no sources; its threads run in each machine's
          personal workspace.
        </EmptyStatePanel>
      ) : (
        <View className="gap-2">
          <Text variant="label">Sources</Text>
          <Text variant="caption">
            Where this project is checked out. One folder per machine.
          </Text>
          <View className="overflow-hidden rounded-md border border-border">
            {project.sources.length === 0 ? (
              <View className="px-4 py-4">
                <Text variant="caption">No sources yet.</Text>
              </View>
            ) : (
              project.sources.map((source, index) => {
                const host = hostById.get(source.hostId);
                return (
                  <View key={source.id}>
                    {index > 0 ? <Separator /> : null}
                    <ListRow
                      title={host?.name ?? "Unknown machine"}
                      subtitle={source.path}
                      leading={
                        <View className="w-5 items-center">
                          <HostStatusDot
                            connected={host?.status === "connected"}
                          />
                        </View>
                      }
                      trailing={
                        <Icon
                          name="MoreHorizontal"
                          size={18}
                          color={tokens.mutedForeground}
                        />
                      }
                      onPress={() => {
                        setSourceForMenu(source);
                        sourceMenu.present();
                      }}
                      onLongPress={() => {
                        setSourceForMenu(source);
                        sourceMenu.present();
                      }}
                      testID={`project-source-${source.hostId}`}
                    />
                  </View>
                );
              })
            )}
            <Separator />
            <ListRow
              title="Add source…"
              subtitle={
                addableHosts.length === 0
                  ? hosts.length === 0
                    ? "No machines connected"
                    : "Every machine already has a source"
                  : "Clone or point at a folder on another machine"
              }
              leading="FolderPlus"
              trailing="chevron"
              disabled={addableHosts.length === 0}
              onPress={addHostSheet.present}
              testID="project-add-source"
            />
          </View>
        </View>
      )}

      {isPersonal ? null : (
        <View className="gap-2 pt-2">
          <Button
            variant="destructive"
            icon="Trash2"
            onPress={deleteConfirm.present}
            loading={deleteProject.isPending}
            testID="project-delete"
          >
            Delete project
          </Button>
          <Text variant="caption">
            Deletes the project and every thread in it from bb. Files on your
            machines are left alone.
          </Text>
        </View>
      )}

      <ActionSheet
        controller={sourceMenu}
        title={hostById.get(sourceForMenu?.hostId ?? "")?.name ?? "Source"}
        message={sourceForMenu?.path}
        actions={[
          {
            key: "remove",
            label: "Remove source",
            icon: "FolderMinus",
            destructive: true,
            onPress: () => removeConfirm.present(),
          },
        ]}
      />
      <ActionSheet
        controller={removeConfirm}
        title="Remove this source?"
        message={
          sourceForMenu
            ? `bb stops using ${sourceForMenu.path} on ${hostById.get(sourceForMenu.hostId)?.name ?? "that machine"} for this project. The folder stays on disk.`
            : undefined
        }
        actions={[
          {
            key: "confirm-remove",
            label: "Remove",
            icon: "Trash2",
            destructive: true,
            onPress: () => {
              if (!sourceForMenu) return;
              removeSource.mutate(
                { projectId: project.id, sourceId: sourceForMenu.id },
                { onSuccess: () => toast.success("Source removed") },
              );
            },
          },
        ]}
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
      <ActionSheet
        controller={deleteConfirm}
        title={`Delete ${project.name}?`}
        message="This removes the project and all of its threads from bb. This cannot be undone."
        actions={[
          {
            key: "confirm-delete",
            label: "Delete project",
            icon: "Trash2",
            destructive: true,
            onPress: () => {
              deleteProject.mutate(project.id, {
                onSuccess: () => {
                  toast.success(`Deleted ${project.name}`);
                  router.dismissTo("/");
                },
              });
            },
          },
        ]}
      />
    </Screen>
  );
}
