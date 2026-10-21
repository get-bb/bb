import type { PluginThreadActionTarget } from "@get-bb/plugin-sdk";
import { useIndexedAppCommandHandlers } from "@/components/commands/AppCommandProvider";
import { hasThreadActionCommandTarget } from "@/components/thread/ThreadActionCommandHandler";
import {
  PANE_THREAD_ACTION_COMMAND_IDS,
  threadActionCommandEntry,
} from "@/lib/thread-actions/thread-action-commands";
import { usePaneContext } from "./PaneContext";

export function PaneThreadActionCommandHandler({
  thread,
}: {
  thread: PluginThreadActionTarget;
}) {
  const { isFocused } = usePaneContext();
  const entryFor = (index: number) => {
    const command = PANE_THREAD_ACTION_COMMAND_IDS[index];
    return command === undefined
      ? null
      : threadActionCommandEntry(command, thread);
  };

  useIndexedAppCommandHandlers(
    PANE_THREAD_ACTION_COMMAND_IDS,
    (index) => {
      const entry = entryFor(index);
      if (entry === null) return false;
      void entry.action.run();
      return true;
    },
    0,
    isFocused,
    (index, { target }) =>
      !hasThreadActionCommandTarget(target) && entryFor(index) !== null,
  );

  return null;
}
