import { useMemo } from "react";
import type { ThreadResponse } from "@bb/server-contract";
import type { ThreadPromptParentThreadSection } from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { useThread } from "@/hooks/queries/thread-queries";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";

export function useParentThreadSection(
  thread: ThreadResponse,
  enabled: boolean,
): ThreadPromptParentThreadSection | null {
  const threadOriginKind = thread.originKind;
  const threadSourceThreadId =
    thread.sourceThreadId ?? (threadOriginKind ? thread.parentThreadId : null);
  const { data: parentThread } = useThread(
    enabled ? (thread.parentThreadId ?? "") : "",
  );
  const { data: sourceThread } = useThread(
    enabled ? (threadSourceThreadId ?? "") : "",
  );
  return useMemo(() => {
    const relatedThreadId =
      threadOriginKind !== null ? threadSourceThreadId : thread.parentThreadId;
    if (!enabled || !relatedThreadId) return null;
    const relationship = threadOriginKind === "fork" ? "fork" : "parent";
    const relatedThread =
      relationship === "parent" ? parentThread : sourceThread;
    const href = getThreadRoutePath({
      projectId: relatedThread?.projectId ?? thread.projectId,
      threadId: relatedThreadId,
    });
    if (relatedThread === undefined) {
      return {
        parentThreadTitle: relatedThreadId.slice(0, 8),
        href,
        relationship,
      };
    }
    if (
      relatedThread.archivedAt !== null ||
      relatedThread.deletedAt !== null ||
      (relationship !== "parent" &&
        relatedThread.projectId !== thread.projectId)
    ) {
      return null;
    }
    return {
      parentThreadTitle: getThreadDisplayTitle(relatedThread),
      href,
      relationship,
    };
  }, [
    enabled,
    parentThread,
    sourceThread,
    thread.parentThreadId,
    thread.projectId,
    threadOriginKind,
    threadSourceThreadId,
  ]);
}
