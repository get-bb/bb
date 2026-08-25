import { describe, expect, it } from "vitest";
import type { PromptHistoryScope } from "@bb/domain";
import { noopNotifier } from "../../src/notifier.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import {
  capPromptHistoryEntries,
  createPromptHistoryEntry,
  listStoredThreadPromptHistoryRows,
} from "../../src/data/prompt-history.js";
import { promptHistoryEntries } from "../../src/schema.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    status: "idle",
  });
  const siblingThread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    status: "idle",
  });
  return { db, project, thread, siblingThread };
}

interface SeedEntriesArgs {
  count: number;
  db: ReturnType<typeof setup>["db"];
  projectId: string;
  scope: PromptHistoryScope;
  startRequestSequence?: number;
  threadId: string;
}

function seedEntries(args: SeedEntriesArgs): void {
  const startRequestSequence = args.startRequestSequence ?? 1;
  const baseCreatedAt = Date.now() - args.count * 1_000;
  for (let index = 0; index < args.count; index += 1) {
    createPromptHistoryEntry(args.db, {
      createdAt: baseCreatedAt + index * 1_000,
      input: [{ type: "text", text: `prompt ${index}`, mentions: [] }],
      projectId: args.projectId,
      requestSequence: startRequestSequence + index,
      scope: args.scope,
      threadId: args.threadId,
    });
  }
}

function countEntries(
  db: ReturnType<typeof setup>["db"],
): number {
  return db.select().from(promptHistoryEntries).all().length;
}

describe("capPromptHistoryEntries", () => {
  it("keeps only the newest entries per (thread, scope) and leaves under-cap scopes alone", () => {
    const { db, project, thread, siblingThread } = setup();

    seedEntries({
      count: 12,
      db,
      projectId: project.id,
      scope: "thread",
      threadId: thread.id,
    });
    seedEntries({
      count: 3,
      db,
      projectId: project.id,
      scope: "project",
      startRequestSequence: 100,
      threadId: thread.id,
    });
    seedEntries({
      count: 5,
      db,
      projectId: project.id,
      scope: "thread",
      threadId: siblingThread.id,
    });

    const result = capPromptHistoryEntries(db, {
      keepPerScope: 10,
      maxScopes: 100,
    });

    expect(result).toEqual({ deleted: 2, scopesCapped: 1 });
    expect(countEntries(db)).toBe(18);

    // The kept window is exactly the newest rows in read order.
    const keptRows = listStoredThreadPromptHistoryRows(db, {
      limit: 50,
      threadId: thread.id,
    });
    expect(keptRows).toHaveLength(10);
    expect(keptRows[0]?.requestSequence).toBe(12);
    expect(keptRows.at(-1)?.requestSequence).toBe(3);
  });

  it("bounds each pass by maxScopes and converges across passes", () => {
    const { db, project, thread, siblingThread } = setup();

    seedEntries({
      count: 4,
      db,
      projectId: project.id,
      scope: "thread",
      threadId: thread.id,
    });
    seedEntries({
      count: 4,
      db,
      projectId: project.id,
      scope: "thread",
      threadId: siblingThread.id,
    });

    const firstPass = capPromptHistoryEntries(db, {
      keepPerScope: 2,
      maxScopes: 1,
    });
    expect(firstPass).toEqual({ deleted: 2, scopesCapped: 1 });

    const secondPass = capPromptHistoryEntries(db, {
      keepPerScope: 2,
      maxScopes: 1,
    });
    expect(secondPass).toEqual({ deleted: 2, scopesCapped: 1 });

    expect(
      capPromptHistoryEntries(db, { keepPerScope: 2, maxScopes: 1 }),
    ).toEqual({ deleted: 0, scopesCapped: 0 });
    expect(countEntries(db)).toBe(4);
  });
});
