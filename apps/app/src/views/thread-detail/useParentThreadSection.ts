import type { Thread } from "@bb/domain";
import type { ThreadPromptParentThreadSection } from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { useThread } from "@/hooks/queries/thread-queries";
import { useSidebarThread } from "@/lib/plugin-sidebar-hooks";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";

type RelatedThread = Pick<
  Thread,
  | "id"
  | "projectId"
  | "title"
  | "titleFallback"
  | "parentThreadId"
  | "sourceThreadId"
  | "originKind"
  | "archivedAt"
  | "deletedAt"
>;

function useRelatedThread(threadId: string): RelatedThread | null {
  const live = useSidebarThread(threadId);
  const { data: fetched } = useThread(live === null ? threadId : "");
  if (live !== null) return { ...live, deletedAt: null };
  return fetched ?? null;
}

export function useParentThreadSection(
  threadId: string,
): ThreadPromptParentThreadSection | null {
  const thread = useRelatedThread(threadId);
  const relationship = thread?.originKind === "fork" ? "fork" : "parent";
  const relatedThreadId =
    thread === null
      ? null
      : relationship === "fork"
        ? (thread.sourceThreadId ?? thread.parentThreadId)
        : thread.parentThreadId;
  const related = useRelatedThread(relatedThreadId ?? "");
  if (
    thread === null ||
    relatedThreadId === null ||
    related === null ||
    related.archivedAt !== null ||
    related.deletedAt !== null ||
    (relationship === "fork" && related.projectId !== thread.projectId)
  ) {
    return null;
  }
  return {
    parentThreadTitle: getThreadDisplayTitle(related),
    href: getThreadRoutePath({
      projectId: related.projectId,
      threadId: relatedThreadId,
    }),
    relationship,
  };
}
