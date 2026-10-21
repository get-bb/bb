import { useQueryClient } from "@tanstack/react-query";
import { useIndexedAppCommandHandlers } from "@/components/commands/AppCommandProvider";
import { lookupCachedThread, resolveThread } from "@/lib/cached-thread";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import {
  THREAD_ACTION_COMMAND_IDS,
  threadActionCommandApplies,
  threadActionCommandEntry,
} from "@/lib/thread-actions/thread-action-commands";
import { getOpenThreadActionMenuTarget } from "@/lib/thread-actions/thread-action-menu-target";
import { toThreadActionTarget } from "@/lib/thread-actions/thread-action-target";

const SIDEBAR_THREAD_ROW_SELECTOR = "[data-sidebar-thread-id]";

function focusedSidebarThreadId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const threadId = target.closest<HTMLElement>(SIDEBAR_THREAD_ROW_SELECTOR)
    ?.dataset.sidebarThreadId;
  return threadId === undefined || threadId === "" ? null : threadId;
}

export function hasThreadActionCommandTarget(
  target: EventTarget | null,
): boolean {
  return (
    getOpenThreadActionMenuTarget() !== null ||
    focusedSidebarThreadId(target) !== null
  );
}

export function ThreadActionCommandHandler() {
  const queryClient = useQueryClient();
  useIndexedAppCommandHandlers(
    THREAD_ACTION_COMMAND_IDS,
    (index, { target }) => {
      const command = THREAD_ACTION_COMMAND_IDS[index];
      if (command === undefined) return false;
      const menu = getOpenThreadActionMenuTarget();
      if (menu !== null) {
        const entry = threadActionCommandEntry(
          command,
          menu.thread,
          menu.requestRename,
        );
        if (entry !== null) {
          void entry.action.run();
          menu.close();
        }
        return true;
      }
      const rowThreadId = focusedSidebarThreadId(target);
      if (rowThreadId === null) return false;
      resolveThread(queryClient, rowThreadId).then(
        (thread) =>
          void threadActionCommandEntry(
            command,
            toThreadActionTarget(thread, null),
          )?.action.run(),
        (error: unknown) =>
          showMutationErrorToast({
            error,
            fallbackMessage: "Failed to load thread.",
          }),
      );
      return true;
    },
    10,
    true,
    (index, { target }) => {
      const command = THREAD_ACTION_COMMAND_IDS[index];
      if (command === undefined) return false;
      const menu = getOpenThreadActionMenuTarget();
      if (menu !== null)
        return threadActionCommandApplies(command, menu.thread);
      const rowThreadId = focusedSidebarThreadId(target);
      if (rowThreadId === null) return false;
      const cached = lookupCachedThread(queryClient, rowThreadId);
      return (
        cached === null ||
        threadActionCommandApplies(command, toThreadActionTarget(cached, null))
      );
    },
  );
  return null;
}
