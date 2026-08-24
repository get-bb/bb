import {
  deriveProjectNameFromPath,
  getProjectPathValidationMessage,
  normalizeProjectPathInput,
  type Host,
} from "@bb/domain";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { useProfiles } from "@/app-shell";
import { useHosts, usePrimaryHost } from "@/data/hosts";
import { useCreateProject } from "@/data/projects";
import { useTheme } from "@/theme";
import { Button, Icon, Input, ListRow, Text, toast, useSheet } from "@/ui";
import { HostPicker, HostStatusDot, RemotePathBrowserSheet } from "../pickers";
import { newThreadHref } from "../shell/hrefs";
import { Screen } from "../shell/Screen";

/**
 * `/projects/new`: name + machine + folder (remote path browser, may create
 * a folder) → `POST /projects` with one `local_path` source → the compose
 * screen for the new project. Mirrors the web ProjectPathDialog "create".
 * Cloning onto another machine is a per-project follow-up (Project settings
 * → Add source), as in the web app.
 */
export function NewProjectScreen() {
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <Screen testID="new-project-screen">
        <Text variant="title">New project</Text>
        <Text variant="caption">Add a server first.</Text>
      </Screen>
    );
  }
  return <ConnectedNewProjectScreen />;
}

function ConnectedNewProjectScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const hostsQuery = useHosts();
  const hosts = useMemo(() => hostsQuery.data ?? [], [hostsQuery.data]);
  const primaryHost = usePrimaryHost();
  const [pickedHostId, setPickedHostId] = useState<string | null>(null);
  const host: Host | null = useMemo(() => {
    const picked = hosts.find((candidate) => candidate.id === pickedHostId);
    if (picked) return picked;
    if (primaryHost?.status === "connected") return primaryHost;
    return hosts.find((candidate) => candidate.status === "connected") ?? null;
  }, [hosts, pickedHostId, primaryHost]);
  const [path, setPath] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  const hostSheet = useSheet();
  const pathSheet = useSheet();
  const createProject = useCreateProject();

  const derivedName = path ? deriveProjectNameFromPath(path) : "";
  const effectiveName = (nameTouched ? name : name || derivedName).trim();
  const noMachineOnline =
    hosts.length > 0 && !hosts.some((h) => h.status === "connected");

  const submit = async () => {
    if (createProject.isPending) return;
    if (!host) {
      setValidationMessage("Pick a machine that is online.");
      return;
    }
    if (!path) {
      setValidationMessage("Choose the project folder.");
      return;
    }
    const normalizedPath = normalizeProjectPathInput(path);
    const pathMessage = getProjectPathValidationMessage(normalizedPath);
    if (pathMessage) {
      setValidationMessage(pathMessage);
      return;
    }
    if (effectiveName.length === 0) {
      setValidationMessage("Give the project a name.");
      return;
    }
    setValidationMessage(null);
    try {
      const project = await createProject.mutateAsync({
        name: effectiveName,
        source: { type: "local_path", hostId: host.id, path: normalizedPath },
      });
      toast.success(`Added ${project.name}`);
      router.navigate(newThreadHref({ projectId: project.id }));
    } catch {
      // The profile QueryClient's mutation error toast already reported it.
    }
  };

  return (
    <Screen testID="new-project-screen">
      <View className="gap-1">
        <Text variant="title">New project</Text>
        <Text variant="caption">
          Point bb at a folder on one of your machines. The folder is resolved
          on that machine, not on this phone.
        </Text>
      </View>

      <View className="gap-2">
        <Text variant="label">Machine</Text>
        <View className="overflow-hidden rounded-md border border-border">
          <ListRow
            title={
              host?.name ??
              (hostsQuery.isLoading
                ? "Loading machines…"
                : hosts.length === 0
                  ? "No machines connected"
                  : "Select a machine")
            }
            subtitle={
              host
                ? host.status === "connected"
                  ? hosts.length > 1 && host.id === primaryHost?.id
                    ? "Primary machine"
                    : undefined
                  : "Offline"
                : noMachineOnline
                  ? "Every machine is offline. Bring one online to browse its folders."
                  : undefined
            }
            leading={
              host ? (
                <View className="w-5 items-center">
                  <HostStatusDot connected={host.status === "connected"} />
                </View>
              ) : (
                <Icon name="Laptop" size={20} color={tokens.mutedForeground} />
              )
            }
            trailing="chevron"
            disabled={hosts.length === 0}
            onPress={hostSheet.present}
            testID="new-project-host"
          />
        </View>
        <HostPicker
          controller={hostSheet}
          hideTrigger
          hosts={hosts}
          value={host?.id ?? null}
          onChange={(hostId) => {
            setPickedHostId(hostId);
            setPath(null);
            setValidationMessage(null);
          }}
          hostIdsWithSource={null}
          primaryHostId={primaryHost?.id ?? null}
          testID="new-project-host-picker"
        />
      </View>

      <View className="gap-2">
        <Text variant="label">Folder</Text>
        <View className="overflow-hidden rounded-md border border-border">
          <ListRow
            title={path ?? "Choose a folder…"}
            subtitle={
              path
                ? undefined
                : `Browse ${host?.name ?? "the machine"}'s folders`
            }
            leading="Folder"
            trailing="chevron"
            disabled={!host || host.status !== "connected"}
            onPress={pathSheet.present}
            titleLines={2}
            testID="new-project-path"
          />
        </View>
        <RemotePathBrowserSheet
          controller={pathSheet}
          hostId={host?.status === "connected" ? host.id : null}
          hostName={host?.name ?? null}
          title="Project folder"
          initialPath={path}
          allowCreateFolder
          onSelect={(selected) => {
            setPath(selected);
            setValidationMessage(null);
          }}
          testID="new-project-path-sheet"
        />
      </View>

      <View className="gap-2">
        <Text variant="label">Name</Text>
        <Input
          value={nameTouched ? name : name || derivedName}
          onChangeText={(next) => {
            setNameTouched(true);
            setName(next);
            setValidationMessage(null);
          }}
          placeholder={derivedName || "Project name"}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          editable={!createProject.isPending}
          testID="new-project-name"
        />
      </View>

      {validationMessage ? (
        <View
          className="rounded-md border border-surface-destructive-border bg-surface-destructive px-3 py-2"
          testID="new-project-error"
        >
          <Text variant="caption" tone="destructive">
            {validationMessage}
          </Text>
        </View>
      ) : null}

      <Button
        onPress={() => void submit()}
        loading={createProject.isPending}
        disabled={!host || host.status !== "connected" || !path}
        icon="FolderPlus"
        testID="new-project-submit"
      >
        Add project
      </Button>
    </Screen>
  );
}
