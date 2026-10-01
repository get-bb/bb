import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PERSONAL_PROJECT_ID, type PromptInput } from "@bb/domain";
import {
  createConnection,
  createQueuedThreadMessage,
  createThread,
  migrate,
  noopNotifier,
} from "../src/index.js";
import { dropPluginEnabledFollowsDefaultColumn } from "./helpers/rewind.js";

const THREAD_DRAFTS_MIGRATION_TIMESTAMP = 1790322211064;
const originalMigration = readFileSync(
  new URL("./fixtures/0132_thread_drafts_original.sql", import.meta.url),
  "utf8",
);

function text(value: string): PromptInput {
  return { type: "text", text: value, mentions: [] };
}

it.each([false, true])(
  "removes the native draft schema without moving queue data (original migration applied: %s)",
  (alreadyMigrated) => {
    const db = createConnection(":memory:");
    try {
      migrate(db);
      const draftThread = createThread(db, noopNotifier, {
        projectId: PERSONAL_PROJECT_ID,
        providerId: "test-provider",
        status: "pending",
      });
      const followUpThread = createThread(db, noopNotifier, {
        projectId: PERSONAL_PROJECT_ID,
        providerId: "test-provider",
        status: "idle",
      });
      const queue = (
        threadId: string,
        content: PromptInput[],
        pluginId: string | null,
      ) =>
        createQueuedThreadMessage(db, noopNotifier, {
          threadId,
          content,
          model: "test-model",
          reasoningLevel: "medium",
          permissionMode: "auto",
          serviceTier: "default",
          waitingOn:
            pluginId === null
              ? null
              : { kind: "plugin", pluginId, reason: "Draft" },
          sendAt: null,
          payload: { kind: "inline" },
          systemNotice: null,
        });
      queue(draftThread.id, [text("First draft")], "drafts");
      queue(followUpThread.id, [text("Draft one")], "drafts");
      queue(
        followUpThread.id,
        [
          text("Draft two"),
          { type: "localFile", path: "/tmp/notes.md", name: "notes.md" },
        ],
        "drafts",
      );
      queue(followUpThread.id, [text("Queued for real")], null);
      queue(followUpThread.id, [text("Held elsewhere")], "concurrency-limit");
      db.$client.exec(
        `INSERT INTO plugins (id, source, provenance, source_kind, source_builtin_name, root_dir, version, installed_at, updated_at)
         VALUES ('drafts', 'builtin:drafts', 'builtin', 'builtin', 'drafts', '/tmp/drafts', '0.1.0', 1, 1)`,
      );
      db.$client
        .prepare("DELETE FROM __drizzle_migrations WHERE created_at >= ?")
        .run(THREAD_DRAFTS_MIGRATION_TIMESTAMP);

      if (alreadyMigrated) {
        db.$client.exec(originalMigration);
        db.$client
          .prepare(
            "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
          )
          .run(
            createHash("sha256").update(originalMigration).digest("hex"),
            THREAD_DRAFTS_MIGRATION_TIMESTAMP,
          );
        expect(
          db.$client
            .prepare("SELECT draft FROM threads WHERE draft IS NOT NULL")
            .all(),
        ).toHaveLength(2);
      }

      const queueBefore = db.$client
        .prepare("SELECT * FROM queued_thread_messages ORDER BY id")
        .all();
      const pluginsBefore = db.$client
        .prepare("SELECT * FROM plugins ORDER BY id")
        .all();
      const threadsBefore = db.$client
        .prepare("SELECT id, status FROM threads ORDER BY id")
        .all();
      expect(queueBefore).toHaveLength(alreadyMigrated ? 2 : 5);

      dropPluginEnabledFollowsDefaultColumn(db);
      migrate(db);
      migrate(db);

      expect(
        db.$client
          .prepare("SELECT * FROM queued_thread_messages ORDER BY id")
          .all(),
      ).toEqual(queueBefore);
      expect(
        db.$client.prepare("SELECT * FROM plugins ORDER BY id").all(),
      ).toEqual(pluginsBefore);
      expect(
        db.$client.prepare("SELECT id, status FROM threads ORDER BY id").all(),
      ).toEqual(threadsBefore);
      expect(
        db.$client
          .prepare(
            "SELECT name FROM pragma_table_info('threads') WHERE name = 'draft'",
          )
          .all(),
      ).toEqual([]);
      expect(db.$client.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.$client.close();
    }
  },
);
