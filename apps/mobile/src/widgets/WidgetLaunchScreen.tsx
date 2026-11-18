import { useProfiles } from "@/app-shell";
import { waitForActiveConnection } from "@/app-shell/connector";
import { getProfileStore } from "@/lib/native";
import type { ServerProfile } from "@/lib/profiles";
import { GroupedScreen } from "@/screens/settings/GroupedScreen";
import { firstParam, webViewShellHref } from "@/screens/shell/hrefs";
import { GroupedRow, GroupedSection, Spinner, Text } from "@/ui";
import { getThreadRoutePath } from "@bb/client-core";
import { BbHttpError } from "@bb/sdk/browser";
import type { CreateThreadEnvironmentArgs } from "@bb/server-contract";
import { requireOptionalNativeModule } from "expo";
import { File } from "expo-file-system";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { WidgetPhotoCapture } from "./WidgetPhotoCapture";
import { withWidgetSdk } from "./widget-sdk";
import { widgetTargetSchema, type WidgetTarget } from "./widget-target";

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
  if (target === null)
    return (
      <WidgetLaunchError message="Open this shortcut from your Android home screen." />
    );
  const profile = profiles.find(
    (candidate) => candidate.id === target.profileId,
  );
  if (!profile)
    return (
      <WidgetLaunchError message="This widget’s server is no longer saved in bb." />
    );
  return <WidgetLaunch profile={profile} target={target} />;
}

function widgetEnvironment(target: WidgetTarget): CreateThreadEnvironmentArgs {
  if (target.hostId === null) return { type: "project-default" };
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

async function startWidgetThread(
  profile: ServerProfile,
  target: WidgetTarget,
  uri?: string,
) {
  return withWidgetSdk(profile, undefined, async (sdk) => {
    const options = {
      origin: "app" as const,
      projectId: target.projectId,
      environment: widgetEnvironment(target),
      ...(target.providerId === null ? {} : { providerId: target.providerId }),
      ...(target.model === null ? {} : { model: target.model }),
      ...(target.reasoningLevel === null
        ? {}
        : { reasoningLevel: target.reasoningLevel }),
    };
    if (uri === undefined)
      return sdk.threads.spawn({ ...options, createEmpty: true });
    const clientFile = new File(uri);
    const attachment = await sdk.projects.attachments.upload({
      projectId: target.projectId,
      clientFile,
    });
    return sdk.threads.spawn({
      ...options,
      input: [{ type: "localImage", path: attachment.path }],
    });
  });
}

function WidgetLaunch({
  profile,
  target,
}: {
  profile: ServerProfile;
  target: WidgetTarget;
}) {
  const router = useRouter();
  const creation = useRef<ReturnType<typeof startWidgetThread> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openThread = useCallback(
    async (
      thread: Awaited<ReturnType<typeof startWidgetThread>>,
      signal?: AbortSignal,
    ) => {
      await getProfileStore().setActiveProfile(profile.id);
      const ready = await waitForActiveConnection(profile.id);
      if (signal?.aborted) return;
      if (!ready) throw new Error("Server profile did not activate");
      router.replace(
        webViewShellHref({
          path: getThreadRoutePath({
            projectId: thread.projectId,
            threadId: thread.id,
          }),
        }),
      );
    },
    [profile.id, router],
  );

  useEffect(() => {
    if (target.action !== "thread") return;
    const guard = new AbortController();
    creation.current ??= startWidgetThread(profile, target);
    void creation.current
      .then(async (thread) => {
        if (!guard.signal.aborted) await openThread(thread, guard.signal);
      })
      .catch((cause: unknown) => {
        if (guard.signal.aborted) return;
        setError(
          cause instanceof BbHttpError && cause.status === 404
            ? "This project or machine is no longer available."
            : "Could not start the thread. Check the saved server and widget settings.",
        );
      });
    return () => guard.abort();
  }, [openThread, profile, target]);

  if (error) return <WidgetLaunchError message={error} />;
  return (
    <GroupedScreen>
      {target.action === "photo" ? (
        <WidgetPhotoCapture
          onCancel={() => router.replace("/")}
          onUsePhoto={async (photo) => {
            creation.current ??= startWidgetThread(profile, target, photo.uri);
            const thread = await creation.current.catch((cause: unknown) => {
              creation.current = null;
              throw cause;
            });
            await openThread(thread);
          }}
        />
      ) : (
        <Spinner />
      )}
    </GroupedScreen>
  );
}

function WidgetLaunchError({ message }: { message: string }) {
  const router = useRouter();
  return (
    <GroupedScreen>
      <Text>{message}</Text>
      <GroupedSection>
        <GroupedRow title="Open bb" onPress={() => router.replace("/")} />
      </GroupedSection>
    </GroupedScreen>
  );
}
