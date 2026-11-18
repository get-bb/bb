import { useProfiles } from "@/app-shell";
import { waitForActiveConnection } from "@/app-shell/connector";
import { getProfileStore } from "@/lib/native";
import { firstParam, webViewShellHref } from "@/screens/shell/hrefs";
import { GroupedScreen } from "@/screens/settings/GroupedScreen";
import { GroupedRow, GroupedSection, Spinner, Text } from "@/ui";
import { getProjectComposeRoutePath } from "@bb/client-core";
import { BbHttpError } from "@bb/sdk/browser";
import { randomUUID } from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { readWidgetProjects } from "./widget-projects";

export function WidgetLaunchScreen() {
  const params = useLocalSearchParams<{
    profileId?: string;
    projectId?: string;
  }>();
  const profileId = firstParam(params.profileId);
  const projectId = firstParam(params.projectId);
  return (
    <WidgetLaunch
      key={JSON.stringify([profileId, projectId])}
      profileId={profileId}
      projectId={projectId}
    />
  );
}

function WidgetLaunch({
  profileId,
  projectId,
}: {
  profileId: string | undefined;
  projectId: string | undefined;
}) {
  const router = useRouter();
  const { status, profiles } = useProfiles();
  const profile = profiles.find((candidate) => candidate.id === profileId);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const invalidProject =
    !projectId || !/^proj_[A-Za-z0-9_-]+$/u.test(projectId);

  useEffect(() => {
    if (!profile || invalidProject) return;
    const controller = new AbortController();
    const { signal } = controller;
    const open = async () => {
      await readWidgetProjects(profile, signal, (projects) =>
        projects.get({ projectId, signal }),
      );
      if (signal.aborted) return;
      await getProfileStore().setActiveProfile(profile.id);
      const ready = await waitForActiveConnection(profile.id);
      if (signal.aborted) return;
      if (!ready) throw new Error("Server profile did not activate");
      const path = `${getProjectComposeRoutePath(projectId)}?widgetLaunch=${randomUUID()}`;
      router.replace(webViewShellHref({ path }));
    };
    void open().catch((cause: unknown) => {
      if (signal.aborted) return;
      setError(
        cause instanceof BbHttpError && cause.status === 404
          ? "This project is no longer available. Add a widget for another project."
          : "Could not open the project. Check the saved server and try again.",
      );
    });
    return () => controller.abort();
  }, [attempt, invalidProject, profile, projectId, router]);

  const message = invalidProject
    ? "This widget has an invalid project."
    : status === "ready" && !profile
      ? "This widget’s server is no longer saved in bb."
      : error;
  return (
    <GroupedScreen>
      {message ? (
        <>
          <Text>{message}</Text>
          <GroupedSection>
            {error ? (
              <GroupedRow
                title="Try again"
                onPress={() => {
                  setError(null);
                  setAttempt((value) => value + 1);
                }}
              />
            ) : null}
            <GroupedRow title="Open bb" onPress={() => router.replace("/")} />
          </GroupedSection>
        </>
      ) : (
        <Spinner />
      )}
    </GroupedScreen>
  );
}
