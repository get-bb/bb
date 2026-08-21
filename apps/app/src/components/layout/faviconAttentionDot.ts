import type { ThreadListEntry } from "@bb/domain";
import { isSidebarProjectThread } from "@bb/client-core";
import { isThreadRead, type ThreadReadState } from "@bb/client-core";

type FaviconSidebarThread = ThreadReadState &
  Pick<
    ThreadListEntry,
    | "hasPendingInteraction"
    | "id"
    | "originKind"
    | "parentThreadId"
    | "visibility"
  >;

interface ShouldShowFaviconAttentionDotArgs {
  // Whether the thread currently in view is blocked on a pending interaction.
  // Sourced from the thread's own pending-interactions query, since the sidebar
  // list can't see archived threads or side chats.
  currentThreadHasPendingInteraction: boolean;
  currentThreadId?: string | null;
  isThreadView: boolean;
  sidebarThreads: readonly FaviconSidebarThread[];
  thread: ThreadReadState | null | undefined;
}

function isUnreadSidebarThread(thread: FaviconSidebarThread): boolean {
  return isSidebarProjectThread(thread) && !isThreadRead(thread);
}

// A thread blocked on the user (an agent question or a permission approval)
// stays `active`, so it never bumps its unread marker. Surface it from the
// sidebar only when no thread is focused. While viewing a thread, the focused
// route pane exclusively owns favicon attention, just as it owns the title.
// Side chats are excluded here to match the unread sidebar scan.
function isPendingSidebarThread(thread: FaviconSidebarThread): boolean {
  return isSidebarProjectThread(thread) && thread.hasPendingInteraction;
}

function isPendingDelegatedChildOfCurrentThread(
  thread: FaviconSidebarThread,
  currentThreadId: string,
): boolean {
  return (
    thread.parentThreadId === currentThreadId &&
    thread.originKind === null &&
    thread.hasPendingInteraction
  );
}

export function shouldShowFaviconAttentionDot({
  currentThreadHasPendingInteraction,
  currentThreadId,
  isThreadView,
  sidebarThreads,
  thread,
}: ShouldShowFaviconAttentionDotArgs): boolean {
  if (isThreadView) {
    const childNeedsAttention =
      currentThreadId != null &&
      sidebarThreads.some((candidate) =>
        isPendingDelegatedChildOfCurrentThread(candidate, currentThreadId),
      );
    return (
      currentThreadHasPendingInteraction ||
      childNeedsAttention ||
      Boolean(thread && !isThreadRead(thread))
    );
  }

  return sidebarThreads.some(
    (candidate) =>
      isPendingSidebarThread(candidate) || isUnreadSidebarThread(candidate),
  );
}
