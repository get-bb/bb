import type { ThreadPromptParentThreadSection } from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { getThreadLocationPath } from "@/lib/route-paths";
import { useThreadState } from "@/lib/thread-state";
import { getThreadDisplayTitle } from "@/lib/thread-title";

export function useParentThreadSection(
  threadId: string,
): ThreadPromptParentThreadSection | null {
  const { thread } = useThreadState(threadId);
  const relationship = thread?.originKind === "fork" ? "fork" : "parent";
  const relatedThreadId =
    thread === null
      ? null
      : relationship === "fork"
        ? (thread.sourceThreadId ?? thread.parentThreadId)
        : thread.parentThreadId;
  const { thread: related } = useThreadState(relatedThreadId ?? "");
  if (
    thread === null ||
    relatedThreadId === null ||
    related === null ||
    related.archivedAt !== null ||
    (relationship === "fork" && related.projectId !== thread.projectId)
  ) {
    return null;
  }
  return {
    parentThreadTitle: getThreadDisplayTitle(related),
    href: getThreadLocationPath({
      projectId: related.projectId,
      threadId: relatedThreadId,
    }),
    relationship,
  };
}
