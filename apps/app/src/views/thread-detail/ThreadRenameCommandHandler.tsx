import type { Thread } from "@bb/domain";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import { usePaneContext } from "./PaneContext";

export function ThreadRenameCommandHandler({ thread }: { thread: Thread }) {
  const { isFocused } = usePaneContext();
  const { requestRename } = useThreadActions();

  useAppCommandHandler("thread.rename", () => {
    if (!isFocused) return false;
    requestRename(thread);
    return true;
  });

  return null;
}
