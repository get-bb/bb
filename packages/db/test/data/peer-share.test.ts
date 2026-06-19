import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { listEvents } from "../../src/data/events.js";
import {
  importThreadEvents,
  type ImportedThreadEventInput,
} from "../../src/data/peer-share.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "imported-threads",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    environmentId: null,
    status: "idle",
  });
  return { db, thread };
}

describe("importThreadEvents", () => {
  it("inserts shared events verbatim under the new thread with no environment", () => {
    const { db, thread } = setup();
    const events: ImportedThreadEventInput[] = [
      {
        sequence: 1,
        scopeKind: "turn",
        turnId: "turn_a",
        providerThreadId: "prov_1",
        type: "client/turn/requested",
        itemId: null,
        itemKind: null,
        data: JSON.stringify({ hello: "world" }),
        createdAt: 1000,
      },
      {
        sequence: 2,
        scopeKind: "thread",
        turnId: null,
        providerThreadId: null,
        type: "client/thread/start",
        itemId: null,
        itemKind: null,
        data: "{}",
        createdAt: 1001,
      },
    ];

    const inserted = importThreadEvents(db, noopNotifier, {
      threadId: thread.id,
      events,
    });
    expect(inserted).toBe(2);

    const rows = listEvents(db, { threadId: thread.id });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.sequence).toBe(1);
    expect(rows[0]!.scopeKind).toBe("turn");
    expect(rows[0]!.turnId).toBe("turn_a");
    expect(rows[0]!.environmentId).toBeNull();
    expect(rows[0]!.data).toBe(JSON.stringify({ hello: "world" }));
    expect(rows[1]!.sequence).toBe(2);
    expect(rows[1]!.scopeKind).toBe("thread");
    expect(rows[1]!.turnId).toBeNull();
  });

  it("is idempotent on (thread, sequence) so a re-accept does not duplicate", () => {
    const { db, thread } = setup();
    const events: ImportedThreadEventInput[] = [
      {
        sequence: 1,
        scopeKind: "thread",
        turnId: null,
        providerThreadId: null,
        type: "client/thread/start",
        itemId: null,
        itemKind: null,
        data: "{}",
        createdAt: 1000,
      },
    ];
    importThreadEvents(db, noopNotifier, { threadId: thread.id, events });
    importThreadEvents(db, noopNotifier, { threadId: thread.id, events });
    expect(listEvents(db, { threadId: thread.id })).toHaveLength(1);
  });
});
