import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createEnvironment } from "../../src/data/environments.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createTerminalSession } from "../../src/data/terminal-sessions.js";
import {
  archiveThread,
  createThread,
  listArchivedThreadsPendingTeardown,
} from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import { threads } from "../../src/schema.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";
import type { ThreadStatus } from "@bb/domain";
import type { TerminalSessionStatus } from "@bb/domain";

function setup(status: ThreadStatus) {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const environment = createEnvironment(db, noopNotifier, {
    projectId: project.id,
    hostId: host.id,
    path: "/tmp/environment",
    providerOwnsPath: false,
    status: "ready",
    environmentProvider: null,
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    environmentId: environment.id,
    status,
  });
  return { db, environment, host, thread };
}

function seedTerminal(
  db: ReturnType<typeof createMigratedConnection>,
  args: {
    environmentId: string;
    hostId: string;
    status: TerminalSessionStatus;
    threadId: string;
  },
) {
  return createTerminalSession(db, {
    cols: 80,
    daemonSessionId: null,
    environmentId: args.environmentId,
    hostId: args.hostId,
    initialCwd: "/tmp/environment",
    rows: 24,
    status: args.status,
    threadId: args.threadId,
    title: "dev server",
  });
}

describe("listArchivedThreadsPendingTeardown", () => {
  it("returns an archived thread whose status still holds host work", () => {
    const { db, thread } = setup("active");

    expect(listArchivedThreadsPendingTeardown(db)).toEqual([]);

    archiveThread(db, noopNotifier, thread.id);

    expect(listArchivedThreadsPendingTeardown(db)).toMatchObject([
      { id: thread.id, status: "active" },
    ]);
  });

  it("returns an archived idle thread only while a terminal session is open", () => {
    const { db, environment, host, thread } = setup("active");
    const terminal = seedTerminal(db, {
      environmentId: environment.id,
      hostId: host.id,
      status: "running",
      threadId: thread.id,
    });
    archiveThread(db, noopNotifier, thread.id);
    db.update(threads)
      .set({ status: "idle" })
      .where(eq(threads.id, thread.id))
      .run();

    expect(listArchivedThreadsPendingTeardown(db)).toMatchObject([
      { id: thread.id, status: "idle" },
    ]);

    db.update(threads).set({ status: "idle" }).run();
    seedTerminal(db, {
      environmentId: environment.id,
      hostId: host.id,
      status: "exited",
      threadId: thread.id,
    });
    expect(listArchivedThreadsPendingTeardown(db)).toMatchObject([
      { id: thread.id },
    ]);

    db.update(threads).set({ archivedAt: null }).run();
    expect(listArchivedThreadsPendingTeardown(db)).toEqual([]);

    archiveThread(db, noopNotifier, thread.id);
    expect(listArchivedThreadsPendingTeardown(db)).toMatchObject([
      { id: terminal.threadId },
    ]);
  });

  it("skips an archived idle thread with no open terminal session", () => {
    const { db, environment, host, thread } = setup("active");
    seedTerminal(db, {
      environmentId: environment.id,
      hostId: host.id,
      status: "exited",
      threadId: thread.id,
    });
    archiveThread(db, noopNotifier, thread.id);
    db.update(threads)
      .set({ status: "idle" })
      .where(eq(threads.id, thread.id))
      .run();

    expect(listArchivedThreadsPendingTeardown(db)).toEqual([]);
  });
});
