import type { PluginThreadActionTarget } from "@get-bb/plugin-sdk";
import { useIndexedAppCommandHandlers } from "@/components/commands/AppCommandProvider";
import { CORE_PLUGIN_ID } from "@bb/domain";
import { useThreadActionEntries } from "@/lib/thread-actions/thread-action-registry";
import { usePaneContext } from "./PaneContext";

const PANE_THREAD_ACTION_COMMANDS = [
  "thread.pin",
  "thread.markRead",
  "thread.archive",
] as const;

const PANE_THREAD_ACTION_KEYS = [
  `${CORE_PLUGIN_ID}/pin`,
  `${CORE_PLUGIN_ID}/read`,
  `${CORE_PLUGIN_ID}/archive`,
];

export function PaneThreadActionCommandHandler({
  thread,
}: {
  thread: PluginThreadActionTarget;
}) {
  const { isFocused } = usePaneContext();
  const entries = useThreadActionEntries(thread, {
    keys: PANE_THREAD_ACTION_KEYS,
  });
  const entryFor = (index: number) => {
    if (
      PANE_THREAD_ACTION_COMMANDS[index] === "thread.archive" &&
      thread.archivedAt !== null
    ) {
      return undefined;
    }
    const key = PANE_THREAD_ACTION_KEYS[index];
    return entries.find((entry) => entry.key === key);
  };

  useIndexedAppCommandHandlers(
    PANE_THREAD_ACTION_COMMANDS,
    (index) => {
      const entry = entryFor(index);
      if (entry === undefined) return false;
      void entry.action.run();
      return true;
    },
    0,
    isFocused,
    (index) => entryFor(index) !== undefined,
  );

  return null;
}
