import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";
import { useProfiles } from "@/app-shell";
import { getFileName } from "@/data/files";
import { useThreadDetailBootstrap } from "@/data/thread-detail";
import { useThread } from "@/data/threads";
import { EmptyStatePanel, Skeleton } from "@/ui";
import { Screen } from "../shell/Screen";
import {
  parseFilePreviewRouteParams,
  type FilePreviewRouteParams,
} from "./file-preview-target";
import { FilePreviewView } from "./FilePreviewView";
import { FilesTabContent } from "./FilesTabContent";

function ThreadFilesBody({
  threadId,
  params,
}: {
  threadId: string;
  params: FilePreviewRouteParams;
}) {
  const bootstrap = useThreadDetailBootstrap(threadId);
  const threadQuery = useThread(threadId);
  const thread = threadQuery.data;
  const parsed = useMemo(() => parseFilePreviewRouteParams(params), [params]);
  const environment = bootstrap.data?.environment ?? null;
  const hostId = bootstrap.data?.host?.id ?? null;
  const projectId = thread?.projectId ?? null;

  if (!thread && !bootstrap.data) {
    if (threadQuery.error || bootstrap.error) {
      return (
        <View className="p-4" testID="thread-files-error">
          <EmptyStatePanel>Could not load this thread.</EmptyStatePanel>
        </View>
      );
    }
    return (
      <View className="gap-3 p-4" testID="thread-files-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </View>
    );
  }

  if (parsed === null) {
    return (
      <>
        <Stack.Screen options={{ title: "Files" }} />
        <FilesTabContent
          threadId={threadId}
          projectId={projectId}
          environmentId={environment?.id ?? null}
          hostId={hostId}
          testID="thread-files-screen-tab"
        />
      </>
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: getFileName(parsed.target.path) }} />
      <FilePreviewView
        threadId={threadId}
        projectId={projectId}
        environmentId={environment?.id ?? null}
        hostId={hostId}
        workspaceRootPath={environment?.path ?? null}
        target={parsed.target}
        lineRange={parsed.lineRange}
      />
    </>
  );
}

/**
 * `/threads/[id]/files`: the Files tab full-screen (search + storage
 * browser) when no file is named, otherwise the file preview for
 * `?kind=&path=&line=[&source=&status=]` (see `file-preview-target.ts`).
 */
export function FilePreviewScreen() {
  const params = useLocalSearchParams<
    { id: string } & Record<keyof FilePreviewRouteParams, string>
  >();
  const { connection } = useProfiles();
  const { id, kind, path, line, source, status } = params;
  const routeParams = useMemo<FilePreviewRouteParams>(
    () => ({ kind, path, line, source, status }),
    [kind, line, path, source, status],
  );
  if (!connection || !id) {
    return (
      <Screen testID="thread-files-screen">
        <EmptyStatePanel>No active server.</EmptyStatePanel>
      </Screen>
    );
  }
  return (
    <Screen scroll={false} testID="thread-files-screen">
      <ThreadFilesBody
        key={`${id}:${kind ?? ""}:${path ?? ""}`}
        threadId={id}
        params={routeParams}
      />
    </Screen>
  );
}
