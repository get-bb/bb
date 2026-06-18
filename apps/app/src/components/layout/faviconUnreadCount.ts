import type { ThreadListEntry } from "@bb/domain";
import { isSidebarProjectThread } from "@/components/sidebar/projectThreadGroups";
import {
  isThreadRead,
  type ThreadReadState,
} from "@/lib/thread-read-state";

type FaviconSidebarThread = ThreadReadState &
  Pick<ThreadListEntry, "originKind" | "childOrigin">;

interface GetFaviconUnreadCountArgs {
  isThreadView: boolean;
  sidebarThreads: readonly FaviconSidebarThread[];
  thread: ThreadReadState | null | undefined;
}

function isUnreadSidebarThread(thread: FaviconSidebarThread): boolean {
  return isSidebarProjectThread(thread) && !isThreadRead(thread);
}

export function getFaviconUnreadCount({
  isThreadView,
  sidebarThreads,
  thread,
}: GetFaviconUnreadCountArgs): number {
  if (isThreadView) {
    return thread && !isThreadRead(thread) ? 1 : 0;
  }

  return sidebarThreads.filter(isUnreadSidebarThread).length;
}
