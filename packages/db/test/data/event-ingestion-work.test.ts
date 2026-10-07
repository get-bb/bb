import {
  appendDaemonEventsInTransaction,
  appendStoredThreadEventsInTransaction,
  copyStoredThreadEventsInTransaction,
  createConnection,
  createProject,
  createThread,
  insertEvents,
  listStoredEventRows,
  migrate,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import { threadScope } from "@bb/domain";
import { expect, it } from "vitest";

it.each(["daemon", "stored", "import", "copy"] as const)(
  "bounds pruning writes for %s event batches and rolls them back with events",
  (mode) => {
    const db = createConnection(":memory:");
    migrate(db);
    const host = upsertHost(db, noopNotifier, { name: "ingestion" });
    const { project } = createProject(db, noopNotifier, {
      name: "ingestion",
      source: { type: "local_path", hostId: host.id, path: "/tmp/ingestion" },
    });
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "benchmark",
    });
    const source = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "benchmark",
    });
    const stored = (threadId: string) =>
      Array.from({ length: 128 }, () => ({
        threadId,
        scope: threadScope(),
        type: "system/error" as const,
        data: { message: "benchmark" },
      }));
    db.transaction((tx) =>
      appendStoredThreadEventsInTransaction(tx, stored(source.id)),
    );
    const copied = listStoredEventRows(db, { threadId: source.id });
    let sequence = 0;
    const append = () => {
      const inputs = stored(thread.id);
      switch (mode) {
        case "daemon":
          db.transaction((tx) =>
            appendDaemonEventsInTransaction(
              tx,
              inputs.map((input) => ({
                ...input,
                data: JSON.stringify(input.data),
                environmentId: null,
                providerThreadId: null,
                itemId: null,
                itemKind: null,
                parentToolCallId: null,
              })),
            ),
          );
          break;
        case "stored":
          db.transaction((tx) =>
            appendStoredThreadEventsInTransaction(tx, inputs),
          );
          break;
        case "import":
          insertEvents(
            db,
            noopNotifier,
            inputs.map((input) => ({
              ...input,
              sequence: ++sequence,
              data: JSON.stringify(input.data),
              itemId: null,
              itemKind: null,
              parentToolCallId: null,
            })),
          );
          break;
        case "copy":
          db.transaction((tx) =>
            copyStoredThreadEventsInTransaction(tx, {
              rows: copied,
              targetThreadId: thread.id,
              targetEnvironmentId: null,
            }),
          );
          break;
      }
    };
    const changes = () =>
      db.$client.prepare("SELECT total_changes()").pluck().get();
    try {
      const before = changes();
      if (typeof before !== "number")
        throw new Error("Invalid SQLite change count");
      append();
      const after = changes();
      if (typeof after !== "number")
        throw new Error("Invalid SQLite change count");
      expect(after - before).toBeLessThanOrEqual(128 + 1);
      expect(
        db.$client
          .prepare(
            "SELECT count(*) FROM thread_pruning_work WHERE thread_id = ?",
          )
          .pluck()
          .get(thread.id),
      ).toBe(1);
      append();
      const coalesced = changes();
      if (typeof coalesced !== "number")
        throw new Error("Invalid SQLite change count");
      expect(coalesced - after).toBe(128);
      db.$client
        .prepare("DELETE FROM thread_pruning_work WHERE thread_id = ?")
        .run(thread.id);
      expect(() =>
        db.transaction(() => {
          append();
          throw new Error("rollback ingestion");
        }),
      ).toThrow("rollback ingestion");
      expect(listStoredEventRows(db, { threadId: thread.id })).toHaveLength(
        256,
      );
      expect(
        db.$client
          .prepare(
            "SELECT count(*) FROM thread_pruning_work WHERE thread_id = ?",
          )
          .pluck()
          .get(thread.id),
      ).toBe(0);
    } finally {
      db.$client.close();
    }
  },
);
