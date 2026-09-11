import type { PushNotificationHistoryEntry } from "./contract.js";

const HISTORY_LIMIT = 200;

export function createPushNotificationHistory() {
  const entries = new Map<string, PushNotificationHistoryEntry>();
  return {
    record(entry: PushNotificationHistoryEntry): void {
      entries.set(entry.id, entry);
      if (entries.size > HISTORY_LIMIT) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
    },
    list(): PushNotificationHistoryEntry[] {
      return [...entries.values()].reverse();
    },
  };
}

export type PushNotificationHistory = ReturnType<
  typeof createPushNotificationHistory
>;
