import { expect, it } from "vitest";
import { PERSONAL_PROJECT_ID, type PromptInput } from "@bb/domain";
import {
  createConnection,
  createQueuedThreadMessage,
  createThread,
  migrate,
  noopNotifier,
} from "../src/index.js";

const THREAD_DRAFTS_MIGRATION_TIMESTAMP = 1790322211064;

function text(value: string): PromptInput {
  return { type: "text", text: value, mentions: [] };
}

it("moves Drafts plugin holds into thread drafts and leaves other queued rows", () => {
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
        model: "gpt-5",
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
    const queuedFollowUp = queue(
      followUpThread.id,
      [text("Queued for real")],
      null,
    );
    const otherPluginHold = queue(
      followUpThread.id,
      [text("Held elsewhere")],
      "concurrency-limit",
    );
    db.$client.exec(
      `INSERT INTO plugins (id, source, provenance, source_kind, source_builtin_name, root_dir, version, installed_at, updated_at)
       VALUES ('drafts', 'builtin:drafts', 'builtin', 'builtin', 'drafts', '/tmp/drafts', '0.1.0', 1, 1)`,
    );

    db.$client.exec("ALTER TABLE threads DROP COLUMN draft");
    db.$client
      .prepare("DELETE FROM __drizzle_migrations WHERE created_at >= ?")
      .run(THREAD_DRAFTS_MIGRATION_TIMESTAMP);
    migrate(db);

    const draftOf = (threadId: string) =>
      db.$client
        .prepare<[string], { draft: string | null }>(
          "SELECT draft FROM threads WHERE id = ?",
        )
        .get(threadId)?.draft;
    expect(JSON.parse(draftOf(draftThread.id) ?? "null")).toEqual([
      text("First draft"),
    ]);
    expect(JSON.parse(draftOf(followUpThread.id) ?? "null")).toEqual([
      text("Draft one"),
      text("Draft two"),
      { type: "localFile", path: "/tmp/notes.md", name: "notes.md" },
    ]);
    expect(
      db.$client
        .prepare<[], { id: string }>(
          "SELECT id FROM queued_thread_messages ORDER BY id",
        )
        .all()
        .map((row) => row.id)
        .sort(),
    ).toEqual([queuedFollowUp.id, otherPluginHold.id].sort());
    expect(
      db.$client.prepare("SELECT id FROM plugins WHERE id = 'drafts'").all(),
    ).toEqual([]);
  } finally {
    db.$client.close();
  }
});
