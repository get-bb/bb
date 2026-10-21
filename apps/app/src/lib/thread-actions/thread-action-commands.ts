import type { AppCommandId } from "@bb/domain";
import type {
  PluginThreadActionEntry,
  PluginThreadActionTarget,
} from "@get-bb/plugin-sdk";
import {
  CORE_THREAD_ACTION_OWNER,
  evaluateThreadActionEntries,
} from "./thread-action-registry";

export const THREAD_ACTION_COMMAND_IDS = [
  "thread.pin",
  "thread.markRead",
  "thread.rename",
  "thread.archive",
] as const satisfies readonly AppCommandId[];

export const PANE_THREAD_ACTION_COMMAND_IDS = [
  "thread.pin",
  "thread.markRead",
  "thread.archive",
] as const satisfies readonly AppCommandId[];

export type ThreadActionCommandId = (typeof THREAD_ACTION_COMMAND_IDS)[number];

const THREAD_ACTION_KEYS: Record<ThreadActionCommandId, string> = {
  "thread.pin": `${CORE_THREAD_ACTION_OWNER}/pin`,
  "thread.markRead": `${CORE_THREAD_ACTION_OWNER}/read`,
  "thread.rename": `${CORE_THREAD_ACTION_OWNER}/rename`,
  "thread.archive": `${CORE_THREAD_ACTION_OWNER}/archive`,
};

const THREAD_ACTION_COMMANDS_BY_KEY = new Map<string, ThreadActionCommandId>(
  THREAD_ACTION_COMMAND_IDS.map((command) => [
    THREAD_ACTION_KEYS[command],
    command,
  ]),
);

export function threadActionCommand(
  key: string,
): ThreadActionCommandId | undefined {
  return THREAD_ACTION_COMMANDS_BY_KEY.get(key);
}

export function threadActionCommandApplies(
  command: ThreadActionCommandId,
  thread: PluginThreadActionTarget,
): boolean {
  return command !== "thread.archive" || thread.archivedAt === null;
}

export function threadActionCommandEntry(
  command: ThreadActionCommandId,
  thread: PluginThreadActionTarget,
  requestRename?: (threadId: string) => void,
): PluginThreadActionEntry | null {
  if (!threadActionCommandApplies(command, thread)) return null;
  return (
    evaluateThreadActionEntries(thread, {
      keys: [THREAD_ACTION_KEYS[command]],
      ...(requestRename === undefined ? {} : { requestRename }),
    })[0] ?? null
  );
}
