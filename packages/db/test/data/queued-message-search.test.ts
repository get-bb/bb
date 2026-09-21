import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type PromptInput } from "@bb/domain";
import { noopNotifier } from "../../src/notifier.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  archiveThread,
  createThread,
  deleteThread,
  searchThreadsWithPendingInteractionState,
} from "../../src/data/threads.js";
import {
  createQueuedThreadMessage,
  deleteQueuedThreadMessage,
  updateQueuedThreadMessage,
} from "../../src/data/queued-thread-messages.js";

function text(text: string, visibility?: "agent-only"): PromptInput {
  return { type: "text", text, mentions: [], ...(visibility ? { visibility } : {}) };
}

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "search-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "search-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/search" },
  });
  const thread = (status: "pending" | "idle" = "pending", visibility: "visible" | "hidden" = "visible") =>
    createThread(db, noopNotifier, { projectId: project.id, providerId: "codex", title: "Conversation", status, visibility });
  const save = (threadId: string, content: PromptInput[]) =>
    createQueuedThreadMessage(db, noopNotifier, {
      threadId, content, model: "gpt-5", reasoningLevel: "medium",
      permissionMode: "full", serviceTier: "default",
      waitingOn: { kind: "plugin", pluginId: "drafts", reason: "Draft" },
      sendAt: null, payload: { kind: "inline" }, systemNotice: null,
    });
  const search = (query: string, limitPerGroup = 20) =>
    searchThreadsWithPendingInteractionState(db, { query, limitPerGroup });
  return { db, thread, save, search };
}

describe("saved message thread search", () => {
  it("finds both first messages and follow-ups once per thread with normal snippets and no event anchor", () => {
    const { db, thread, save, search } = setup();
    try {
      const pending = thread();
      const existing = thread("idle");
      save(pending.id, [text("violet launch plan"), text("privatecode", "agent-only")]);
      save(existing.id, [text("violet launch follow-up")]);
      save(existing.id, [text("another violet launch note")]);
      const result = search("violet launch");
      expect(result.active.total).toBe(2);
      expect(new Set(result.active.results.map((row) => row.thread.id))).toEqual(new Set([pending.id, existing.id]));
      for (const row of result.active.results) {
        expect(row.matches[0]).toMatchObject({ sourceKind: "user_message", sourceSeq: null });
        expect(row.matches[0]?.highlightRanges.length).toBeGreaterThan(0);
      }
      expect(search("privatecode").active.total).toBe(0);
      expect(search("violet", 1).active.results).toHaveLength(1);
      expect(search("violet", 1).active.total).toBe(2);
      archiveThread(db, noopNotifier, pending.id);
      expect(search("violet").archived.results[0]?.thread.id).toBe(pending.id);
      const hidden = thread("idle", "hidden");
      save(hidden.id, [text("violet launch hidden")]);
      deleteThread(db, noopNotifier, existing.id);
      expect(search("violet").active.total).toBe(0);
    } finally {
      db.$client.close();
    }
  });

  it("replaces edited content and removes deleted or emptied messages from the index", () => {
    const { db, thread, save, search } = setup();
    try {
      const owner = thread();
      const message = save(owner.id, [text("oldword")]);
      const edited = updateQueuedThreadMessage(db, noopNotifier, {
        id: message.id, threadId: owner.id, expectedUpdatedAt: message.updatedAt,
        content: [text("newword")],
      });
      expect(edited.kind).toBe("updated");
      expect(search("oldword").active.total).toBe(0);
      expect(search("newword").active.total).toBe(1);
      if (edited.kind !== "updated") throw new Error("Expected edited message");
      updateQueuedThreadMessage(db, noopNotifier, {
        id: message.id, threadId: owner.id, expectedUpdatedAt: edited.queuedMessage.updatedAt,
        content: [text("privateword", "agent-only")],
      });
      expect(search("newword").active.total).toBe(0);
      expect(search("privateword").active.total).toBe(0);
      const removed = save(owner.id, [text("removedword")]);
      deleteQueuedThreadMessage(db, noopNotifier, removed.id);
      expect(search("removedword").active.total).toBe(0);
    } finally {
      db.$client.close();
    }
  });

  it("backfills previously saved messages without changing their queue rows", () => {
    const { db, thread, save, search } = setup();
    try {
      db.$client.exec(`
        DROP TRIGGER queued_thread_messages_search_insert;
        DROP TRIGGER queued_thread_messages_search_update;
        DROP TRIGGER queued_thread_messages_search_delete;
      `);
      const owner = thread();
      const saved = save(owner.id, [text("preexistingmessage")]);
      expect(search("preexistingmessage").active.total).toBe(0);
      const migration = readFileSync(resolve(__dirname, "../../drizzle/0128_queued_message_search.sql"), "utf8");
      db.$client.exec(migration);
      expect(search("preexistingmessage").active.results[0]?.thread.id).toBe(owner.id);
      const persisted = db.$client.prepare("SELECT content, waiting_on FROM queued_thread_messages WHERE id = ?").get(saved.id);
      expect(persisted).toEqual({ content: saved.content, waiting_on: saved.waitingOn });
    } finally {
      db.$client.close();
    }
  });
});
