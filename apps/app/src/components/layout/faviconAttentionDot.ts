import type { ThreadListEntry } from "@bb/domain";
import { isSidebarProjectThread } from "@/components/sidebar/projectThreadGroups";
import { isThreadRead, type ThreadReadState } from "@/lib/thread-read-state";

type FaviconSidebarThread = ThreadReadState &
  Pick<ThreadListEntry, "originKind" | "hasPendingInteraction" | "visibility">;

interface ShouldShowFaviconAttentionDotArgs {
  // Whether the thread currently in view is blocked on a pending interaction.
  // Sourced from the thread's own pending-interactions query, since the sidebar
  // list can't see archived threads or side chats.
  currentThreadHasPendingInteraction: boolean;
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

export function shouldShowFaviconAttentionDot({
  currentThreadHasPendingInteraction,
  isThreadView,
  sidebarThreads,
  thread,
}: ShouldShowFaviconAttentionDotArgs): boolean {
  if (isThreadView) {
    return (
      currentThreadHasPendingInteraction ||
      Boolean(thread && !isThreadRead(thread))
    );
  }

  return sidebarThreads.some(
    (candidate) =>
      isPendingSidebarThread(candidate) || isUnreadSidebarThread(candidate),
  );
}
