import type { AppCommandId } from "@bb/domain";
import { CORE_THREAD_ACTION_OWNER } from "./thread-action-registry";

const THREAD_ACTION_COMMANDS_BY_KEY: ReadonlyMap<string, AppCommandId> =
  new Map([
    [`${CORE_THREAD_ACTION_OWNER}/pin`, "thread.pin"],
    [`${CORE_THREAD_ACTION_OWNER}/read`, "thread.markRead"],
    [`${CORE_THREAD_ACTION_OWNER}/rename`, "thread.rename"],
    [`${CORE_THREAD_ACTION_OWNER}/archive`, "thread.archive"],
  ]);

export const THREAD_ACTION_COMMAND_IDS: readonly AppCommandId[] = [
  ...THREAD_ACTION_COMMANDS_BY_KEY.values(),
];

export function threadActionCommand(key: string): AppCommandId | undefined {
  return THREAD_ACTION_COMMANDS_BY_KEY.get(key);
}

export function threadActionKeyForCommand(
  command: AppCommandId,
): string | undefined {
  for (const [key, candidate] of THREAD_ACTION_COMMANDS_BY_KEY) {
    if (candidate === command) return key;
  }
  return undefined;
}
