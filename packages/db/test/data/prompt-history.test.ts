import { describe, expect, it } from "vitest";
import type { PromptHistoryScope, PromptInput } from "@bb/domain";
import { createConnection } from "../../src/connection.js";
import {
  createProject,
  createPromptHistoryEntry,
  createThread,
  listPromptHistoryPage,
  markThreadDeleted,
  upsertHost,
} from "../../src/data/index.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";

type TestDb = ReturnType<typeof createConnection>;

function text(text: string): PromptInput {
  return { type: "text", text, mentions: [] };
}

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const firstProject = createProject(db, noopNotifier, {
    name: "First",
    source: { type: "local_path", hostId: host.id, path: "/tmp/first" },
  }).project;
  const secondProject = createProject(db, noopNotifier, {
    name: "Second",
    source: { type: "local_path", hostId: host.id, path: "/tmp/second" },
  }).project;
  const firstThread = createThread(db, noopNotifier, {
    projectId: firstProject.id,
    providerId: "codex",
  });
  const secondThread = createThread(db, noopNotifier, {
    projectId: firstProject.id,
    providerId: "codex",
  });
  const otherProjectThread = createThread(db, noopNotifier, {
    projectId: secondProject.id,
    providerId: "codex",
  });
  return {
    db,
    firstProject,
    firstThread,
    otherProjectThread,
    secondProject,
    secondThread,
  };
}

function insert(
  db: TestDb,
  args: {
    createdAt: number;
    input: PromptInput[];
    projectId: string;
    requestSequence: number;
    scope: PromptHistoryScope;
    threadId: string;
  },
) {
  return createPromptHistoryEntry(db, args);
}

describe("prompt history page query", () => {
  it("pages every project and thread newest first, breaking ties by sequence and id", () => {
    const fixture = setup();
    const rows = [
      insert(fixture.db, {
        projectId: fixture.firstProject.id,
        threadId: fixture.firstThread.id,
        scope: "project",
        requestSequence: 1,
        createdAt: 10,
        input: [text("first")],
      }),
      insert(fixture.db, {
        projectId: fixture.firstProject.id,
        threadId: fixture.firstThread.id,
        scope: "thread",
        requestSequence: 2,
        createdAt: 20,
        input: [text("second")],
      }),
      insert(fixture.db, {
        projectId: fixture.firstProject.id,
        threadId: fixture.secondThread.id,
        scope: "thread",
        requestSequence: 2,
        createdAt: 20,
        input: [text("tied")],
      }),
      insert(fixture.db, {
        projectId: fixture.secondProject.id,
        threadId: fixture.otherProjectThread.id,
        scope: "thread",
        requestSequence: 3,
        createdAt: 20,
        input: [text("later sequence")],
      }),
    ];
    const expected = [...rows]
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt ||
          right.requestSequence - left.requestSequence ||
          (left.id < right.id ? 1 : -1),
      )
      .map((row) => row.id);

    const pages: string[][] = [];
    let before = null;
    do {
      const page = listPromptHistoryPage(fixture.db, { before, limit: 3 });
      pages.push(page.map((row) => row.id));
      const last = page.at(-1);
      before = page.length === 3 && last !== undefined ? last : null;
    } while (before !== null);

    expect(pages.flat()).toEqual(expected);
    expect(pages.map((page) => page.length)).toEqual([3, 1]);
  });

  it("keeps prompts from soft-deleted threads", () => {
    const fixture = setup();
    const row = insert(fixture.db, {
      projectId: fixture.firstProject.id,
      threadId: fixture.firstThread.id,
      scope: "thread",
      requestSequence: 1,
      createdAt: 10,
      input: [text("still history")],
    });
    markThreadDeleted(fixture.db, noopNotifier, {
      threadId: fixture.firstThread.id,
    });

    expect(
      listPromptHistoryPage(fixture.db, { before: null, limit: 10 }).map(
        (entry) => entry.id,
      ),
    ).toEqual([row.id]);
  });
});
