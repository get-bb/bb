import "../../global.css";
import "@/lib/polyfills";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { requireNativeModule, requireNativeView } from "expo";
import { useEffect, useState } from "react";
import { ScrollView, type ViewProps } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { getProfileStore } from "@/lib/native";
import { useProfileStoreState, type ServerProfile } from "@/lib/profiles";
import { ThemeProvider } from "@/theme";
import { GroupedRow, GroupedSection, Spinner, Text } from "@/ui";
import { withWidgetSdk } from "./widget-sdk";
import { type WidgetTarget, widgetIcons } from "./widget-target";

interface ProjectWidgetModule {
  configure(widgetId: number, targetJson: string): Promise<void>;
}

const queryClient = new QueryClient();
const WidgetIconPreview =
  process.env.EXPO_OS === "android"
    ? requireNativeView<ViewProps & { icon: WidgetTarget["icon"] }>(
        "BBProjectWidget",
      )
    : null;
const iconPreviewStyle = { width: 36, height: 36 };
const iconLabels: Record<WidgetTarget["icon"], string> = {
  message: "Message",
  camera: "Camera",
  microphone: "Microphone",
  code: "Code",
  terminal: "Terminal",
  check: "Check",
  star: "Star",
};

export function WidgetConfiguration({ widgetId }: { widgetId: number }) {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SafeAreaView className="flex-1 bg-background">
          <ScrollView contentContainerStyle={{ gap: 16, padding: 16 }}>
            <Text variant="heading">New thread widget</Text>
            <WidgetPicker widgetId={widgetId} />
          </ScrollView>
        </SafeAreaView>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function WidgetPicker({ widgetId }: { widgetId: number }) {
  const store = getProfileStore();
  const { status, profiles } = useProfileStoreState(store);
  const [profileId, setProfileId] = useState<string | null>(null);
  const profile = profiles.find((candidate) => candidate.id === profileId);
  useEffect(() => {
    void store.load();
  }, [store]);

  if (status !== "ready") return <Spinner />;
  if (profiles.length === 0) {
    return <Text>Add a server in bb, then add this widget again.</Text>;
  }
  if (profile) {
    return (
      <TargetPicker
        key={profile.id}
        widgetId={widgetId}
        profile={profile}
        changeServer={() => setProfileId(null)}
      />
    );
  }
  return (
    <GroupedSection title="Choose a server">
      {profiles.map((server) => (
        <GroupedRow
          key={server.id}
          title={server.label}
          subtitle={server.serverUrl}
          onPress={() => setProfileId(server.id)}
          trailing="chevron"
        />
      ))}
    </GroupedSection>
  );
}

function TargetPicker({
  widgetId,
  profile,
  changeServer,
}: {
  widgetId: number;
  profile: ServerProfile;
  changeServer: () => void;
}) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [reasoningLevel, setReasoningLevel] = useState<string | null>(null);
  const [icon, setIcon] = useState<WidgetTarget["icon"]>("message");
  const [action, setAction] = useState<WidgetTarget["action"]>("thread");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const projects = useQuery(
    {
      queryKey: ["widget-projects", profile.id, profile.serverUrl],
      queryFn: ({ signal }) =>
        withWidgetSdk(profile, signal, (sdk) =>
          sdk.projects.list({ includePersonal: false, signal }),
        ),
      retry: false,
    },
    queryClient,
  );
  const hosts = useQuery(
    {
      queryKey: ["widget-hosts", profile.id, profile.serverUrl],
      queryFn: ({ signal }) =>
        withWidgetSdk(profile, signal, (sdk) => sdk.hosts.list({ signal })),
      retry: false,
    },
    queryClient,
  );
  const providers = useQuery(
    {
      queryKey: [
        "widget-providers",
        profile.id,
        profile.serverUrl,
        hostId,
        projectId,
      ],
      enabled: Boolean(hostId && projectId),
      queryFn: ({ signal }) =>
        withWidgetSdk(profile, signal, (sdk) =>
          sdk.providers.list({ hostId: hostId!, signal }),
        ),
      retry: false,
    },
    queryClient,
  );
  const options = useQuery(
    {
      queryKey: [
        "widget-models",
        profile.id,
        profile.serverUrl,
        hostId,
        projectId,
        providerId,
      ],
      enabled: Boolean(hostId && projectId && providerId),
      queryFn: ({ signal }) =>
        withWidgetSdk(profile, signal, (sdk) =>
          sdk.providers.models({
            hostId: hostId!,
            projectId: projectId!,
            providerId: providerId!,
            signal,
          }),
        ),
      retry: false,
    },
    queryClient,
  );
  const branches = useQuery(
    {
      queryKey: [
        "widget-branches",
        profile.id,
        profile.serverUrl,
        hostId,
        projectId,
      ],
      enabled: Boolean(hostId && projectId),
      queryFn: ({ signal }) =>
        withWidgetSdk(profile, signal, (sdk) =>
          sdk.projects.branches({
            hostId: hostId!,
            projectId: projectId!,
            signal,
          }),
        ),
      retry: false,
    },
    queryClient,
  );

  const project = projects.data?.find((item) => item.id === projectId);
  const models = options.data?.models ?? [];
  const model = models.find((item) => item.id === modelId);
  const uniqueModels = models.filter(
    (item, index) =>
      models.findIndex((candidate) => candidate.model === item.model) === index,
  );
  const compatibleHosts = (hosts.data ?? []).filter(
    (item) =>
      item.status === "connected" &&
      item.lifecycle.phase === "active" &&
      project?.sources.some((source) => source.hostId === item.id),
  );
  const host = compatibleHosts.find((item) => item.id === hostId);
  const duplicateModelValues = new Set(
    models
      .filter(
        (item, index) =>
          models.findIndex((candidate) => candidate.model === item.model) !==
          index,
      )
      .map((item) => item.model),
  );
  const branchesList = branches.data?.branches ?? [];

  async function configure() {
    if (!project || !host) return;
    setSaving(true);
    setSaveFailed(false);
    const target: WidgetTarget = {
      profileId: profile.id,
      projectId: project.id,
      projectName: project.name,
      hostId: host.id,
      providerId,
      model: model?.model ?? null,
      baseBranch: branch,
      reasoningLevel,
      icon,
      action,
    };
    try {
      await requireNativeModule<ProjectWidgetModule>(
        "BBProjectWidget",
      ).configure(widgetId, JSON.stringify(target));
    } catch {
      setSaveFailed(true);
      setSaving(false);
    }
  }

  function chooseProvider(nextProviderId: string) {
    setProviderId(nextProviderId);
    setModelId(null);
    setReasoningLevel(null);
  }

  function chooseModel(nextModelId: string) {
    const nextModel = models.find((item) => item.id === nextModelId);
    setModelId(nextModelId);
    setReasoningLevel(nextModel?.defaultReasoningEffort ?? null);
  }

  return (
    <>
      <GroupedSection title="Server">
        <GroupedRow
          title={profile.label}
          subtitle="Choose another server"
          onPress={changeServer}
          disabled={saving}
          trailing="chevron"
        />
      </GroupedSection>
      {projects.isPending || hosts.isPending ? <Spinner /> : null}
      {projects.isError || hosts.isError ? (
        <GroupedSection title="Could not load setup options">
          <GroupedRow
            title="Try again"
            onPress={() => {
              void projects.refetch();
              void hosts.refetch();
            }}
          />
        </GroupedSection>
      ) : null}
      {projects.isSuccess ? (
        <GroupedSection title="Project">
          {projects.data.map((item) => (
            <GroupedRow
              key={item.id}
              title={item.name}
              selected={item.id === projectId}
              trailing={item.id === projectId ? "checkmark" : undefined}
              onPress={() => {
                setProjectId(item.id);
                setHostId(null);
                setProviderId(null);
                setModelId(null);
                setReasoningLevel(null);
                setBranch(null);
              }}
              disabled={saving}
            />
          ))}
        </GroupedSection>
      ) : null}
      {project ? (
        <GroupedSection title="Machine">
          {compatibleHosts.map((item) => (
            <GroupedRow
              key={item.id}
              title={item.name}
              subtitle={item.status}
              selected={item.id === hostId}
              trailing={item.id === hostId ? "checkmark" : undefined}
              onPress={() => {
                setHostId(item.id);
                setProviderId(null);
                setModelId(null);
                setReasoningLevel(null);
                setBranch(null);
              }}
              disabled={saving}
            />
          ))}
          {compatibleHosts.length === 0 ? (
            <Text>No connected machine has a checkout for this project.</Text>
          ) : null}
        </GroupedSection>
      ) : null}
      {project && host ? (
        <>
          {providers.isPending ? <Spinner /> : null}
          <GroupedSection title="Provider">
            {providers.isError ? (
              <Text>
                Could not load providers. The server default is still available.
              </Text>
            ) : null}
            {providers.isSuccess
              ? providers.data
                  .filter((item) => item.available)
                  .map((item) => (
                    <GroupedRow
                      key={item.id}
                      title={item.displayName}
                      selected={item.id === providerId}
                      trailing={
                        item.id === providerId ? "checkmark" : undefined
                      }
                      onPress={() => chooseProvider(item.id)}
                      disabled={saving}
                    />
                  ))
              : null}
            <GroupedRow
              title="Use server default"
              subtitle="Let bb choose the provider and model"
              selected={providerId === null}
              trailing={providerId === null ? "checkmark" : undefined}
              onPress={() => {
                setProviderId(null);
                setModelId(null);
                setReasoningLevel(null);
              }}
              disabled={saving}
            />
          </GroupedSection>
          {providerId && options.isPending ? <Spinner /> : null}
          {providerId && options.isSuccess ? (
            <GroupedSection title="Model">
              {uniqueModels.map((item) => (
                <GroupedRow
                  key={item.id}
                  title={item.displayName}
                  subtitle={
                    duplicateModelValues.has(item.model)
                      ? "Server-selected route"
                      : item.description || undefined
                  }
                  selected={item.id === modelId}
                  trailing={item.id === modelId ? "checkmark" : undefined}
                  onPress={() => chooseModel(item.id)}
                  disabled={saving}
                />
              ))}
            </GroupedSection>
          ) : null}
          {branches.isPending ? <Spinner /> : null}
          {branches.isSuccess ? (
            <GroupedSection title="Base branch">
              {[
                ...new Set(
                  [branches.data.defaultBranch, ...branchesList].filter(
                    (value): value is string => value !== null,
                  ),
                ),
              ].map((value) => (
                <GroupedRow
                  key={value}
                  title={value}
                  selected={value === branch}
                  trailing={value === branch ? "checkmark" : undefined}
                  onPress={() => setBranch(value)}
                  disabled={saving}
                />
              ))}
              <GroupedRow
                title="Project checkout"
                selected={branch === null}
                trailing={branch === null ? "checkmark" : undefined}
                onPress={() => setBranch(null)}
                disabled={saving}
              />
            </GroupedSection>
          ) : null}
          {branches.isError ? (
            <GroupedSection
              title="Could not load branches"
              footer="You can still save this widget using the project checkout."
            >
              <GroupedRow
                title="Try again"
                onPress={() => void branches.refetch()}
                disabled={saving}
              />
            </GroupedSection>
          ) : null}
        </>
      ) : null}
      {model && model.supportedReasoningEfforts.length > 0 ? (
        <GroupedSection title="Reasoning">
          {model.supportedReasoningEfforts.map((effort) => (
            <GroupedRow
              key={effort.reasoningEffort}
              title={effort.label ?? effort.reasoningEffort}
              selected={effort.reasoningEffort === reasoningLevel}
              trailing={
                effort.reasoningEffort === reasoningLevel
                  ? "checkmark"
                  : undefined
              }
              onPress={() => setReasoningLevel(effort.reasoningEffort)}
              disabled={saving}
            />
          ))}
        </GroupedSection>
      ) : null}
      <GroupedSection title="Widget action">
        <GroupedRow
          title="New thread"
          subtitle="Start with a blank composer"
          selected={action === "thread"}
          trailing={action === "thread" ? "checkmark" : undefined}
          onPress={() => setAction("thread")}
          disabled={saving}
        />
        <GroupedRow
          title="Photo"
          subtitle="Start by taking a photo"
          selected={action === "photo"}
          trailing={action === "photo" ? "checkmark" : undefined}
          onPress={() => setAction("photo")}
          disabled={saving}
        />
        <GroupedRow
          title="Voice input"
          subtitle="Start with voice input ready"
          selected={action === "voice"}
          trailing={action === "voice" ? "checkmark" : undefined}
          onPress={() => setAction("voice")}
          disabled={saving}
        />
      </GroupedSection>
      <GroupedSection title="Icon">
        {widgetIcons.map((item) => (
          <GroupedRow
            key={item}
            title={iconLabels[item]}
            leading={
              WidgetIconPreview && (
                <WidgetIconPreview
                  icon={item}
                  importantForAccessibility="no"
                  style={iconPreviewStyle}
                />
              )
            }
            selected={icon === item}
            trailing={icon === item ? "checkmark" : undefined}
            onPress={() => setIcon(item)}
            disabled={saving}
          />
        ))}
      </GroupedSection>
      {project && host ? (
        <GroupedSection title="Launch">
          <GroupedRow
            title="Save widget"
            subtitle={saving ? "Saving…" : "Create a 1×1 widget"}
            onPress={() => void configure()}
            disabled={saving}
            trailing="chevron"
          />
        </GroupedSection>
      ) : null}
      {saveFailed ? <Text>Could not add the widget. Try again.</Text> : null}
    </>
  );
}
