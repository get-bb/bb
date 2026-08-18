// bb-plugin-t3sidebar backend — the settled / snoozed store.
//
// This state lives in the plugin's own SQLite database, never on bb's thread.
// Putting it on the thread would mean a schema change, a wire change, and a
// HOST_DAEMON_PROTOCOL_VERSION bump for something only this sidebar
// understands. Here, uninstalling the plugin removes its state with it.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const migrations = [
  `CREATE TABLE IF NOT EXISTS thread_lifecycle (
     thread_id      TEXT PRIMARY KEY,
     settled_at     INTEGER,
     snoozed_until  INTEGER,
     snoozed_at     INTEGER
   )`,
];

export interface StoredLifecycleRow {
  threadId: string;
  settledAt: number | null;
  snoozedUntil: number | null;
  snoozedAt: number | null;
}

interface LifecycleDbRow {
  thread_id: string;
  settled_at: number | null;
  snoozed_until: number | null;
  snoozed_at: number | null;
}

const threadIdSchema = z.object({ threadId: z.string().trim().min(1) });

export const t3sidebarRpcContract = defineRpcContract({
  listLifecycle: {
    input: z.object({}),
    output: z.object({
      rows: z.array(
        z.object({
          threadId: z.string(),
          settledAt: z.number().nullable(),
          snoozedUntil: z.number().nullable(),
          snoozedAt: z.number().nullable(),
        }),
      ),
    }),
  },
  settle: { input: threadIdSchema, output: z.object({ ok: z.boolean() }) },
  unsettle: { input: threadIdSchema, output: z.object({ ok: z.boolean() }) },
  snooze: {
    input: z.object({
      threadId: z.string().trim().min(1),
      // Absolute wake time, so a snooze means the same thing on every device.
      snoozedUntil: z.number().int().positive(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  unsnooze: { input: threadIdSchema, output: z.object({ ok: z.boolean() }) },
});

/** Channel the frontend re-reads on. */
export const LIFECYCLE_CHANNEL = "lifecycle";

export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);

  const readAll = (): StoredLifecycleRow[] =>
    (
      db
        .prepare(
          `SELECT thread_id, settled_at, snoozed_until, snoozed_at
             FROM thread_lifecycle`,
        )
        .all() as LifecycleDbRow[]
    ).map((row) => ({
      threadId: row.thread_id,
      settledAt: row.settled_at,
      snoozedUntil: row.snoozed_until,
      snoozedAt: row.snoozed_at,
    }));

  const write = (row: StoredLifecycleRow): void => {
    db.prepare(
      `INSERT INTO thread_lifecycle
         (thread_id, settled_at, snoozed_until, snoozed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         settled_at = excluded.settled_at,
         snoozed_until = excluded.snoozed_until,
         snoozed_at = excluded.snoozed_at`,
    ).run(row.threadId, row.settledAt, row.snoozedUntil, row.snoozedAt);
    bb.realtime.publish(LIFECYCLE_CHANNEL, { threadId: row.threadId });
  };

  const clear = (threadId: string): void => {
    db.prepare(`DELETE FROM thread_lifecycle WHERE thread_id = ?`).run(
      threadId,
    );
    bb.realtime.publish(LIFECYCLE_CHANNEL, { threadId });
  };

  bb.rpc.register(t3sidebarRpcContract, {
    async listLifecycle() {
      return { rows: readAll() };
    },
    async settle({ threadId }) {
      // Settling clears any snooze: they are two answers to the same
      // question, and holding both would make the shelf order ambiguous.
      write({
        threadId,
        settledAt: Date.now(),
        snoozedUntil: null,
        snoozedAt: null,
      });
      return { ok: true };
    },
    async unsettle({ threadId }) {
      clear(threadId);
      return { ok: true };
    },
    async snooze({ threadId, snoozedUntil }) {
      const now = Date.now();
      write({
        threadId,
        settledAt: null,
        snoozedUntil,
        snoozedAt: now,
      });
      return { ok: true };
    },
    async unsnooze({ threadId }) {
      clear(threadId);
      return { ok: true };
    },
  });

  // A deleted thread must not leave a row behind that would park a future
  // thread reusing the id, and stale rows accumulate otherwise.
  bb.events.on("thread.deleted", ({ thread }) => {
    clear(thread.id);
  });
}
