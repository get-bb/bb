import type { PluginThreadActionTarget } from "@get-bb/plugin-sdk";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { useThreadActionEntries } from "@/lib/thread-actions/thread-action-registry";
import { usePaneContext } from "./PaneContext";

const ARCHIVE_KEYS = ["core/archive"];

export function ThreadArchiveCommandHandler({
  thread,
}: {
  thread: PluginThreadActionTarget;
}) {
  const { isFocused } = usePaneContext();
  const [archive] = useThreadActionEntries(thread, { keys: ARCHIVE_KEYS });

  useAppCommandHandler("thread.archive", () => {
    if (!isFocused || thread.archivedAt !== null || archive === undefined) {
      return false;
    }
    void archive.action.run();
    return true;
  });

  return null;
}
