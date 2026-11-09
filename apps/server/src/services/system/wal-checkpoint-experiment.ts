import type Database from "better-sqlite3";
import {
  getExperiments,
  startWalCheckpointer,
  type DbConnection,
  type WalCheckpointer,
  type WalCheckpointLogger,
} from "@bb/db";
import type { NotificationHub } from "../../ws/hub.js";

export function startGatedWalCheckpointer(options: {
  db: DbConnection;
  hub: Pick<NotificationHub, "onChangedMessage">;
  logger: WalCheckpointLogger;
}): WalCheckpointer {
  const databases = new Set<Database.Database>();
  let checkpointer: WalCheckpointer | null = null;
  let stopped = false;
  let pending = Promise.resolve();

  const refresh = (): Promise<void> => {
    const enabled =
      !stopped && getExperiments(options.db).walCheckpointWorker;
    pending = pending.then(async () => {
      if (enabled && checkpointer === null) {
        checkpointer = startWalCheckpointer({ logger: options.logger });
        for (const database of databases) checkpointer.attach(database);
      }
      if (!enabled && checkpointer !== null) {
        const current = checkpointer;
        checkpointer = null;
        await current.stop();
      }
    });
    return pending;
  };

  const unsubscribe = options.hub.onChangedMessage((message) => {
    if (
      message.entity === "system" &&
      message.changes.includes("config-changed")
    ) {
      void refresh();
    }
  });
  void refresh();

  return {
    attach(database) {
      if (stopped) return;
      databases.add(database);
      checkpointer?.attach(database);
    },
    async checkpoint(database) {
      await pending;
      if (checkpointer !== null) {
        await checkpointer.checkpoint(database);
        return;
      }
      if (database.open) database.pragma("wal_checkpoint(PASSIVE)");
    },
    async detach(database) {
      databases.delete(database);
      await pending;
      await checkpointer?.detach(database);
    },
    stop() {
      stopped = true;
      unsubscribe();
      return refresh();
    },
  };
}
