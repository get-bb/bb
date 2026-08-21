import type { Thread } from "@bb/domain";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import { usePaneContext } from "./PaneContext";

export function ThreadArchiveCommandHandler({ thread }: { thread: Thread }) {
  const { isFocused } = usePaneContext();
  const { archiveThreadAndChildren } = useThreadActions();

  useAppCommandHandler("thread.archive", () => {
    if (!isFocused || thread.archivedAt !== null) return false;
    archiveThreadAndChildren(thread);
    return true;
  });

  return null;
}
