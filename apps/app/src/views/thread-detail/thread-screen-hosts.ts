import { useCallback } from "react";
import type { Environment } from "@bb/domain";
import { assertNever } from "@bb/thread-view";
import type { TimelineTitleActionResolver } from "@/components/thread/timeline/TimelineTitleView";
import type { ThreadTimelineLocalFileLinkHandler } from "@/components/thread/timeline/types";
import { resolveGitDiffTabStatus } from "@/components/secondary-panel/gitDiffTabEligibility";
import {
  getThreadFixedTabOwnerId,
  type AppPanelController,
} from "@/lib/app-fixed-tab-navigation";
import type { AppFilePreviewIntent } from "@/lib/app-navigation-host";
import { GIT_DIFF_TAB_REFERENCE } from "@/lib/git-diff-tab";
import {
  SIDE_CHAT_PLUGIN_ID,
  SIDE_CHAT_PLUGIN_PANEL_ACTION_ID,
} from "@/lib/side-chat-plugin";

interface ThreadEnvironmentAccessArgs {
  thread: {
    environmentId: string | null;
    archivedAt: number | null;
  } | null;
  environment: Environment | null;
  environmentLoadFailed: boolean;
}

export function resolveThreadEnvironmentAccess({
  thread,
  environment,
  environmentLoadFailed,
}: ThreadEnvironmentAccessArgs) {
  const hostLifecycle =
    environment === null || environment.hostLifecycle === "active"
      ? null
      : environment.hostLifecycle;
  const executionUnavailable =
    hostLifecycle !== null || environment?.status === "destroyed";
  const gitDiffTabStatus = resolveGitDiffTabStatus({
    environmentId: thread?.environmentId ?? null,
    environmentIsGitRepo: environment?.isGitRepo,
    environmentLoadFailed,
    environmentOwnsPath: environment?.managed,
    hasResolvedThread: thread !== null,
    threadArchived: thread?.archivedAt != null || executionUnavailable,
  });
  const canUseGitUi = !executionUnavailable && gitDiffTabStatus === "eligible";
  return {
    executionUnavailable,
    gitDiffTabStatus,
    canUseGitUi,
    contextEnvironmentId:
      canUseGitUi && environment !== null && thread?.environmentId
        ? thread.environmentId
        : null,
    reusesEnvironment:
      !executionUnavailable &&
      environment !== null &&
      (environment.status === "ready" ||
        environment.status === "provisioning") &&
      environment.path !== null &&
      thread?.environmentId != null,
  };
}

export function useThreadTimelineTitleActions({
  threadId,
  projectId,
  environmentId,
  panel,
  openFilePreview,
  openLocalFileLink,
  openThread,
}: {
  threadId: string;
  projectId: string;
  environmentId: string | null;
  panel: AppPanelController;
  openFilePreview: (intent: AppFilePreviewIntent) => boolean;
  openLocalFileLink: ThreadTimelineLocalFileLinkHandler;
  openThread: (target: { projectId: string; threadId: string }) => void;
}): TimelineTitleActionResolver {
  return useCallback<TimelineTitleActionResolver>(
    (action) => {
      switch (action.kind) {
        case "open-file-diff":
          return () => {
            const openedDiff = panel.openTab({
              tab: GIT_DIFF_TAB_REFERENCE,
              availability: "fixed",
              target: { kind: "file", path: action.path },
            });
            if (openedDiff || environmentId === null) return;
            openFilePreview({
              target: { kind: "workspace", environmentId, path: action.path },
              location: null,
            });
          };
        case "open-local-file":
          return () => {
            openLocalFileLink({
              lineRange: null,
              openTargetId: null,
              path: action.path,
            });
          };
        case "open-plugin-side-chat":
          return () => {
            const openedInPanel = panel.openTab({
              tab: {
                ownerId: getThreadFixedTabOwnerId(SIDE_CHAT_PLUGIN_ID),
                tabId: SIDE_CHAT_PLUGIN_PANEL_ACTION_ID,
              },
              availability: "action",
              params: { threadId: action.threadId, sourceThreadId: threadId },
            });
            if (!openedInPanel)
              openThread({ projectId, threadId: action.threadId });
          };
        default:
          return assertNever(action);
      }
    },
    [
      environmentId,
      openFilePreview,
      openLocalFileLink,
      openThread,
      panel,
      projectId,
      threadId,
    ],
  );
}
