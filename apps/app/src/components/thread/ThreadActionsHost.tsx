import { useQueryClient } from "@tanstack/react-query";
import { lookupCachedThread } from "@/lib/plugin-sidebar-hooks";
import { CORE_THREAD_ACTIONS } from "@/lib/thread-actions/core-thread-actions";
import { ThreadActionCollectors } from "@/lib/thread-actions/thread-action-registry";
import { useThreadActions } from "./ThreadActionsProvider";

export function ThreadActionsHost() {
  const { requestRename } = useThreadActions();
  const queryClient = useQueryClient();
  return (
    <ThreadActionCollectors
      coreRegistrations={CORE_THREAD_ACTIONS}
      requestRename={(threadId) => {
        const thread = lookupCachedThread(queryClient, threadId);
        if (thread === null) return;
        window.setTimeout(() => requestRename(thread), 0);
      }}
    />
  );
}
