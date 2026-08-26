import {
  deriveProjectNameFromPath,
  getProjectPathValidationMessage,
  normalizeProjectPathInput,
  type Host,
} from "@bb/domain";
import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { useProfiles } from "@/app-shell";
import { useHosts, usePrimaryHost } from "@/data/hosts";
import { useCreateProject } from "@/data/projects";
import { useTheme } from "@/theme";
import {
  Button,
  EmptyStatePanel,
  GroupedRow,
  Icon,
  Input,
  Text,
  toast,
  useSheet,
  SheetProvider,
} from "@/ui";
import { HostPicker, HostStatusDot, RemotePathBrowserSheet } from "../pickers";
import { GroupedScreen } from "../settings/GroupedScreen";
import {
  ICON_ROW_SEPARATOR_INSET,
  SettingsSection,
} from "../settings/SettingsRows";
import { newThreadHref } from "../shell/hrefs";

const IS_IOS = process.env.EXPO_OS === "ios";

/**
 * `/projects/new` (a modal on iOS with Cancel / Create in the header): name
 * + machine + folder (remote path browser, may create a folder) →
 * `POST /projects` with one `local_path` source → the compose screen for
 * the new project. Mirrors the web ProjectPathDialog "create". Cloning onto
 * another machine is a per-project follow-up (Project settings → Add
 * source), as in the web app.
 */
export function NewProjectScreen() {
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <GroupedScreen testID="new-project-screen">
        <EmptyStatePanel>Add a server first.</EmptyStatePanel>
      </GroupedScreen>
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
  const canSubmit =
    !createProject.isPending &&
    host !== null &&
    host.status === "connected" &&
    path !== null;

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
      // Pop back to the home entry (dismissing this modal) and hand it the
      // compose params; `navigate` would push the compose route beneath the
      // still-presented sheet on iOS.
      router.dismissTo(newThreadHref({ projectId: project.id }));
    } catch {
      // The profile QueryClient's mutation error toast already reported it.
    }
  };

  return (
    <>
      {IS_IOS ? (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button
              accessibilityLabel="Cancel"
              onPress={() => router.back()}
            >
              Cancel
            </Stack.Toolbar.Button>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button
              variant="done"
              accessibilityLabel="Create project"
              disabled={!canSubmit}
              onPress={() => void submit()}
            >
              Create
            </Stack.Toolbar.Button>
          </Stack.Toolbar>
        </>
      ) : null}
      {/* Own sheet host: this route is a native modal, and sheets from the root
          provider would open behind it. */}
      <SheetProvider>
        <GroupedScreen testID="new-project-screen">
          <SettingsSection
            title="Machine"
            separatorInset={ICON_ROW_SEPARATOR_INSET}
            footnote={
              noMachineOnline
                ? "Every machine is offline. Bring one online to browse its folders."
                : "The folder is resolved on that machine, not on this phone."
            }
          >
            <GroupedRow
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
                  : undefined
              }
              leading={
                host ? (
                  <View className="w-5 items-center">
                    <HostStatusDot connected={host.status === "connected"} />
                  </View>
                ) : (
                  <Icon
                    name="Laptop"
                    size={20}
                    color={tokens.mutedForeground}
                  />
                )
              }
              trailing="chevron"
              disabled={hosts.length === 0}
              onPress={hostSheet.present}
              testID="new-project-host"
            />
          </SettingsSection>
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

          <SettingsSection title="Folder">
            <GroupedRow
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
          </SettingsSection>
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

          <SettingsSection
            title="Name"
            footnote={
              validationMessage ? (
                <Text
                  variant="footnote"
                  tone="destructive"
                  testID="new-project-error"
                >
                  {validationMessage}
                </Text>
              ) : (
                "Defaults to the folder name."
              )
            }
          >
            <View className="px-1">
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
                grouped
                editable={!createProject.isPending}
                accessibilityLabel="Project name"
                testID="new-project-name"
              />
            </View>
          </SettingsSection>

          {IS_IOS ? null : (
            <Button
              onPress={() => void submit()}
              loading={createProject.isPending}
              disabled={!canSubmit}
              icon="FolderPlus"
              testID="new-project-submit"
            >
              Add project
            </Button>
          )}
        </GroupedScreen>
      </SheetProvider>
    </>
  );
}
