import { useProfiles } from "@/app-shell";
import { waitForActiveConnection } from "@/app-shell/connector";
import { getProfileStore } from "@/lib/native";
import type { ServerProfile } from "@/lib/profiles";
import { GroupedScreen } from "@/screens/settings/GroupedScreen";
import { firstParam, webViewShellHref } from "@/screens/shell/hrefs";
import { GroupedRow, GroupedSection, Spinner, Text } from "@/ui";
import { getProjectComposeRoutePath, getThreadRoutePath } from "@bb/client-core";
import type { CreateThreadEnvironmentArgs } from "@bb/server-contract";
import { requireOptionalNativeModule } from "expo";
import { File } from "expo-file-system";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { WidgetPhotoCapture } from "./WidgetPhotoCapture";
import { withWidgetSdk } from "./widget-sdk";
import {
  type PhotoWidgetTarget,
  widgetTargetSchema,
  type WidgetTarget,
} from "./widget-target";

interface ProjectWidgetModule {
  takeLaunch(token: string): Promise<string | null>;
}

async function readTarget(
  token: string | undefined,
): Promise<WidgetTarget | null> {
  if (!token) return null;
  try {
    const json =
      await requireOptionalNativeModule<ProjectWidgetModule>(
        "BBProjectWidget",
      )?.takeLaunch(token);
    if (!json) return null;
    const result = widgetTargetSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function WidgetLaunchScreen() {
  const params = useLocalSearchParams<{ launchToken?: string }>();
  const token = firstParam(params.launchToken);
  return <WidgetLaunchEntry key={token} token={token} />;
}

function WidgetLaunchEntry({ token }: { token: string | undefined }) {
  const { status, profiles } = useProfiles();
  const read = useRef<Promise<WidgetTarget | null> | null>(null);
  const [target, setTarget] = useState<WidgetTarget | null>();
  useEffect(() => {
    read.current ??= readTarget(token);
    void read.current.then(setTarget);
  }, [token]);

  if (target === undefined || status !== "ready") {
    return (
      <GroupedScreen>
        <Spinner />
      </GroupedScreen>
    );
  }
  if (target === null) return <Redirect href="/" />;
  const profile = profiles.find(
    (candidate) => candidate.id === target.profileId,
  );
  if (!profile)
    return (
      <WidgetLaunchError message="This widget’s server is no longer saved in bb." />
    );
  if (target.action === "photo")
    return <WidgetPhotoLaunch profile={profile} target={target} />;
  return <WidgetComposerLaunch profile={profile} target={target} />;
}

async function openInShell(
  router: ReturnType<typeof useRouter>,
  profileId: string,
  path: string,
): Promise<boolean> {
  await getProfileStore().setActiveProfile(profileId);
  const ready = await waitForActiveConnection(profileId);
  if (!ready) return false;
  router.replace(webViewShellHref({ path }));
  return true;
}

function WidgetComposerLaunch({
  profile,
  target,
}: {
  profile: ServerProfile;
  target: WidgetTarget;
}) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const path = getProjectComposeRoutePath(target.projectId);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void openInShell(router, profile.id, path)
      .catch(() => false)
      .then((opened) => {
        if (!cancelled && !opened) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, path, profile.id, router]);

  if (failed)
    return (
      <WidgetLaunchError
        message="Could not connect to this widget’s server."
        retry={{ title: "Try again", run: () => setAttempt((n) => n + 1) }}
      />
    );
  return (
    <GroupedScreen>
      <Spinner />
    </GroupedScreen>
  );
}

function widgetEnvironment(target: PhotoWidgetTarget): CreateThreadEnvironmentArgs {
  return {
    type: "host",
    hostId: target.hostId,
    workspace:
      target.baseBranch === null
        ? { type: "unmanaged", path: null }
        : {
            type: "managed-worktree",
            baseBranch: { kind: "named", name: target.baseBranch },
          },
  };
}

async function startPhotoThread(
  profile: ServerProfile,
  target: PhotoWidgetTarget,
  uri: string,
) {
  return withWidgetSdk(profile, undefined, async (sdk) => {
    const attachment = await sdk.projects.attachments.upload({
      projectId: target.projectId,
      clientFile: new File(uri),
    });
    return sdk.threads.spawn({
      origin: "app",
      projectId: target.projectId,
      environment: widgetEnvironment(target),
      ...(target.providerId === null ? {} : { providerId: target.providerId }),
      ...(target.model === null ? {} : { model: target.model }),
      ...(target.reasoningLevel === null
        ? {}
        : { reasoningLevel: target.reasoningLevel }),
      input: [{ type: "localImage", path: attachment.path }],
    });
  });
}

function WidgetPhotoLaunch({
  profile,
  target,
}: {
  profile: ServerProfile;
  target: PhotoWidgetTarget;
}) {
  const router = useRouter();
  const creation = useRef<ReturnType<typeof startPhotoThread> | null>(null);
  const [threadToReopen, setThreadToReopen] = useState<Awaited<
    ReturnType<typeof startPhotoThread>
  > | null>(null);

  const openThread = useCallback(
    async (thread: Awaited<ReturnType<typeof startPhotoThread>>) => {
      const path = getThreadRoutePath({
        projectId: thread.projectId,
        threadId: thread.id,
      });
      const opened = await openInShell(router, profile.id, path).catch(
        () => false,
      );
      if (!opened) setThreadToReopen(thread);
    },
    [profile.id, router],
  );

  if (threadToReopen) {
    return (
      <WidgetLaunchError
        message="The thread was created, but bb could not open it."
        retry={{
          title: "Open thread",
          run: () => void openThread(threadToReopen),
        }}
      />
    );
  }
  return (
    <GroupedScreen>
      <WidgetPhotoCapture
        onCancel={() => router.replace("/")}
        onUsePhoto={async (photo) => {
          creation.current ??= startPhotoThread(profile, target, photo.uri);
          const thread = await creation.current.catch((cause: unknown) => {
            creation.current = null;
            throw cause;
          });
          await openThread(thread);
        }}
      />
    </GroupedScreen>
  );
}

function WidgetLaunchError({
  message,
  retry,
}: {
  message: string;
  retry?: { title: string; run: () => void };
}) {
  const router = useRouter();
  return (
    <GroupedScreen>
      <Text>{message}</Text>
      <GroupedSection>
        {retry && <GroupedRow title={retry.title} onPress={retry.run} />}
        <GroupedRow title="Open bb" onPress={() => router.replace("/")} />
      </GroupedSection>
    </GroupedScreen>
  );
}
