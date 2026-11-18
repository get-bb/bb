import "../../global.css";
import "@/lib/polyfills";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { requireNativeModule } from "expo";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { getProfileStore } from "@/lib/native";
import { useProfileStoreState, type ServerProfile } from "@/lib/profiles";
import { ThemeProvider } from "@/theme";
import { GroupedRow, GroupedSection, Spinner, Text } from "@/ui";
import { readWidgetProjects } from "./widget-projects";

interface ProjectWidgetModule {
  configure(
    widgetId: number,
    profileId: string,
    projectId: string,
    name: string,
  ): Promise<void>;
}

const queryClient = new QueryClient();

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
      <ProjectPicker
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

function ProjectPicker({
  widgetId,
  profile,
  changeServer,
}: {
  widgetId: number;
  profile: ServerProfile;
  changeServer: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const projects = useQuery(
    {
      queryKey: ["widget-projects", profile.id, profile.serverUrl],
      queryFn: ({ signal }) =>
        readWidgetProjects(profile, signal, (api) =>
          api.list({ includePersonal: false, signal }),
        ),
      retry: false,
    },
    queryClient,
  );

  async function configure(project: { id: string; name: string }) {
    setSaving(true);
    setSaveFailed(false);
    try {
      await requireNativeModule<ProjectWidgetModule>(
        "BBProjectWidget",
      ).configure(widgetId, profile.id, project.id, project.name);
    } catch {
      setSaveFailed(true);
      setSaving(false);
    }
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
      {projects.isPending ? <Spinner /> : null}
      {projects.isError ? (
        <GroupedSection title="Could not load projects">
          <GroupedRow
            title="Try again"
            onPress={() => void projects.refetch()}
          />
        </GroupedSection>
      ) : null}
      {projects.isSuccess && projects.data.length === 0 ? (
        <Text>No projects on this server.</Text>
      ) : null}
      {projects.isSuccess && projects.data.length > 0 ? (
        <GroupedSection title="Choose a project">
          {projects.data.map((project) => (
            <GroupedRow
              key={project.id}
              title={project.name}
              titleLines={2}
              onPress={() => void configure(project)}
              disabled={saving}
            />
          ))}
        </GroupedSection>
      ) : null}
      {saveFailed ? <Text>Could not add the widget. Try again.</Text> : null}
    </>
  );
}
