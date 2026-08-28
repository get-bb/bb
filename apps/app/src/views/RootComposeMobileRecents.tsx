import { useMemo } from "react";
import type { ThreadListEntry } from "@bb/domain";
import { RouteAnchor } from "@/components/ui/app-route-anchor";
import { ThreadStatusGlyph } from "@/components/sidebar/ThreadRow";
import { SIDEBAR_WORKING_STATUS_COLOR_CLASS } from "@/components/sidebar/sidebarRowClasses";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { getThreadRoutePath, isProjectlessProjectId } from "@/lib/route-paths";
import {
  hasActiveBackgroundAgentActivity,
  hasActiveBackgroundCommandActivity,
  hasActiveGoalActivity,
  hasActivePlanModeActivity,
  hasActiveWorkflowActivity,
  getThreadListIndicatorLabel,
  isRuntimeBusyThread,
  isUnreadDoneThread,
  resolveThreadListIndicator,
  type ThreadListIndicatorState,
} from "@bb/client-core";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePromptDraftHasInput } from "@/hooks/usePromptDraftStorage";

const MOBILE_RECENT_THREAD_LIMIT = 3;

type ThreadListEntryComparator = (
  left: ThreadListEntry,
  right: ThreadListEntry,
) => number;

interface GetMobileRecentThreadsArgs {
  highlightedThreadId: string | null;
  threads: readonly ThreadListEntry[];
}

interface MobileRecentThreadRowProps {
  highlighted: boolean;
  projectName: string | null;
  thread: ThreadListEntry;
}

interface RootComposeMobileRecentsProps {
  highlightedThreadId: string | null;
  projectNamesById: ReadonlyMap<string, string>;
  showCreatingRow: boolean;
  threads: readonly ThreadListEntry[];
}

const compareMobileRecentThreads: ThreadListEntryComparator = (left, right) => {
  const latestAttentionAtDelta =
    right.latestAttentionAt - left.latestAttentionAt;
  if (latestAttentionAtDelta !== 0) {
    return latestAttentionAtDelta;
  }

  const createdAtDelta = right.createdAt - left.createdAt;
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return left.id.localeCompare(right.id);
};

function getMobileRecentThreads({
  highlightedThreadId,
  threads,
}: GetMobileRecentThreadsArgs): ThreadListEntry[] {
  const sortedThreads = [...threads].sort(compareMobileRecentThreads);
  if (highlightedThreadId === null) {
    return sortedThreads.slice(0, MOBILE_RECENT_THREAD_LIMIT);
  }

  const highlightedThread = sortedThreads.find(
    (thread) => thread.id === highlightedThreadId,
  );
  if (!highlightedThread) {
    return sortedThreads.slice(0, MOBILE_RECENT_THREAD_LIMIT);
  }

  return [
    highlightedThread,
    ...sortedThreads
      .filter((thread) => thread.id !== highlightedThreadId)
      .slice(0, MOBILE_RECENT_THREAD_LIMIT - 1),
  ];
}

function MobileRecentThreadRow({
  highlighted,
  projectName,
  thread,
}: MobileRecentThreadRowProps) {
  const threadTitle = getThreadDisplayTitle(thread);
  const isUnreadDone = isUnreadDoneThread(thread);
  const isUnreadError = isUnreadDone && thread.status === "error";
  const hasUnsubmittedDraft = usePromptDraftHasInput({
    kind: "thread",
    projectId: thread.projectId,
    threadId: thread.id,
  });
  const indicatorState: ThreadListIndicatorState = {
    hasPendingInteraction: thread.hasPendingInteraction,
    hasUnsubmittedDraft,
    hasUnreadError: isUnreadError,
    hasUnreadSuccess: isUnreadDone && !isUnreadError,
    isBackgroundAgentActive: hasActiveBackgroundAgentActivity(thread),
    isBackgroundCommandActive: hasActiveBackgroundCommandActivity(thread),
    isGoalActive: hasActiveGoalActivity(thread),
    isPlanModeActive: hasActivePlanModeActivity(thread),
    isRuntimeActive: isRuntimeBusyThread(thread),
    isWorkflowActive: hasActiveWorkflowActivity(thread),
  };
  const indicatorLabel = getThreadListIndicatorLabel(
    resolveThreadListIndicator(indicatorState),
  );
  return (
    <li>
      {}
      <RouteAnchor
        href={getThreadRoutePath({
          projectId: thread.projectId,
          threadId: thread.id,
        })}
        aria-label={`Open ${threadTitle}${indicatorLabel ? ` — ${indicatorLabel}` : ""}`}
        className={cn(
          "flex h-8 items-center gap-2 rounded-md px-2 text-sm text-foreground/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          highlighted && "bg-surface-selected",
        )}
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="min-w-0 truncate">{threadTitle}</span>
          {projectName ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {projectName}
            </span>
          ) : null}
        </span>
        <span className="flex size-6 shrink-0 items-center justify-center">
          <ThreadStatusGlyph {...indicatorState} />
        </span>
      </RouteAnchor>
    </li>
  );
}

export function RootComposeMobileRecents({
  highlightedThreadId,
  projectNamesById,
  showCreatingRow,
  threads,
}: RootComposeMobileRecentsProps) {
  const recentThreads = useMemo(
    () => getMobileRecentThreads({ highlightedThreadId, threads }),
    [highlightedThreadId, threads],
  );

  if (!showCreatingRow && recentThreads.length === 0) {
    return null;
  }

  return (
    <section
      data-root-compose-mobile-recents=""
      aria-labelledby="root-compose-mobile-recents"
      className="mt-4 md:hidden"
    >
      <div className="mb-1 px-2">
        <h2
          id="root-compose-mobile-recents"
          className={CHROME_SECTION_LABEL_CLASS}
        >
          Recent
        </h2>
      </div>
      {showCreatingRow ? (
        <div
          role="status"
          className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground"
        >
          <span className="min-w-0 flex-1 truncate">Creating thread</span>
          <span className="flex size-6 shrink-0 items-center justify-center">
            <Icon
              name="Loading"
              className={cn(
                "shrink-0 animate-spin",
                SIDEBAR_WORKING_STATUS_COLOR_CLASS,
                COARSE_POINTER_ICON_SIZE_CLASS,
              )}
              aria-hidden="true"
            />
          </span>
        </div>
      ) : null}
      {recentThreads.length > 0 ? (
        <ul className="space-y-px">
          {recentThreads.map((thread) => (
            <MobileRecentThreadRow
              key={thread.id}
              highlighted={thread.id === highlightedThreadId}
              projectName={
                isProjectlessProjectId(thread.projectId)
                  ? null
                  : (projectNamesById.get(thread.projectId) ?? null)
              }
              thread={thread}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
