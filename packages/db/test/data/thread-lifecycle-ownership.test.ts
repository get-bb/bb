import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { threads } from "../../src/schema.js";
import { noopNotifier as hub } from "../../src/notifier.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";
import {
  createThread,
  archiveThread,
  unarchiveThread,
  markThreadDeleted,
  deleteThread,
  getThread,
} from "../../src/data/threads.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, hub, { name: "host" });
  const { project } = createProject(db, hub, {
    name: "project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/ownership" },
  });
  const spawn = (lifecycleOwnerThreadId?: string) =>
    createThread(db, hub, {
      projectId: project.id,
      providerId: "test",
      lifecycleOwnerThreadId,
      status: "idle",
    });
  return { db, project, host, spawn };
}

describe("lifecycle ownership", () => {
  it("cascades through archived intermediates while preserving ownership and history until leaf deletion", () => {
    const { db, spawn } = setup();
    const owner = spawn();
    const child = spawn(owner.id);
    const leaf = spawn(child.id);
    const independent = spawn();
    archiveThread(db, hub, child.id);
    expect(getThread(db, owner.id)?.archivedAt).toBeNull();
    archiveThread(db, hub, owner.id);
    for (const thread of [owner, child, leaf])
      expect(getThread(db, thread.id)?.archivedAt).toEqual(expect.any(Number));
    expect(unarchiveThread(db, hub, leaf.id)).toBeNull();
    unarchiveThread(db, hub, owner.id);
    expect(getThread(db, child.id)?.archivedAt).toEqual(expect.any(Number));
    unarchiveThread(db, hub, child.id);
    expect(unarchiveThread(db, hub, leaf.id)?.archivedAt).toBeNull();
    markThreadDeleted(db, hub, { threadId: owner.id });
    expect(deleteThread(db, hub, owner.id)).toBe(false);
    expect(() =>
      db.delete(threads).where(eq(threads.id, owner.id)).run(),
    ).toThrow();
    expect(getThread(db, child.id)?.lifecycleOwnerThreadId).toBe(owner.id);
    expect(deleteThread(db, hub, child.id)).toBe(false);
    expect(deleteThread(db, hub, leaf.id)).toBe(true);
    expect(deleteThread(db, hub, child.id)).toBe(true);
    expect(deleteThread(db, hub, owner.id)).toBe(true);
    expect(getThread(db, independent.id)?.deletedAt).toBeNull();
  });

  it("rejects unavailable owners and accepts cross-project owners", () => {
    const { db, spawn, project, host } = setup();
    expect(() => spawn("missing")).toThrow(/lifecycleOwner/);
    const owner = spawn();
    archiveThread(db, hub, owner.id);
    expect(() => spawn(owner.id)).toThrow(/lifecycleOwner/);
    unarchiveThread(db, hub, owner.id);
    markThreadDeleted(db, hub, { threadId: owner.id });
    expect(() => spawn(owner.id)).toThrow(/lifecycleOwner/);
    const live = spawn();
    const other = createProject(db, hub, {
      name: "other",
      source: { type: "local_path", hostId: host.id, path: "/tmp/other" },
    }).project;
    expect(other.id).not.toBe(project.id);
    const dependent = createThread(db, hub, {
      projectId: other.id,
      providerId: "test",
      lifecycleOwnerThreadId: live.id,
    });
    archiveThread(db, hub, live.id);
    expect(getThread(db, dependent.id)?.archivedAt).toEqual(expect.any(Number));
    markThreadDeleted(db, hub, { threadId: live.id });
    expect(getThread(db, dependent.id)?.deletedAt).toEqual(expect.any(Number));
  });

  it("prevents reassignment, cycles, self-ownership and detachment even via SQL", () => {
    const { db, spawn } = setup();
    const owner = spawn();
    const child = spawn(owner.id);
    for (const [id, lifecycleOwnerThreadId] of [
      [owner.id, child.id],
      [owner.id, owner.id],
      [child.id, null],
    ]) {
      expect(() =>
        db
          .update(threads)
          .set({ lifecycleOwnerThreadId })
          .where(eq(threads.id, id!))
          .run(),
      ).toThrow(/immutable/);
    }
  });
});

it("backfills only explicit historical evidence and propagates owner state", () => {
  const { db, spawn, project } = setup();
  const owner = spawn();
  const side = createThread(db, hub, {
    projectId: project.id,
    providerId: "test",
    sourceThreadId: owner.id,
    originKind: "fork",
    originPluginId: "side-chat",
    visibility: "hidden",
  });
  const unknown = createThread(db, hub, {
    projectId: project.id,
    providerId: "test",
    sourceThreadId: owner.id,
    originKind: "fork",
    visibility: "hidden",
    title: "side-chat",
  });
  const worker = createThread(db, hub, {
    projectId: project.id,
    providerId: "test",
    originPluginId: "workflows",
    pluginMetadata: {
      pluginId: "workflows",
      metadata: {
        workflowWorker: 1,
        runId: "run",
        callId: "call",
        originThreadId: owner.id,
      },
    },
  });
  db.update(threads)
    .set({ createdAt: 1, deletedAt: 2, archivedAt: 2 })
    .where(eq(threads.id, owner.id))
    .run();
  const migration = readFileSync(
    new URL("../../drizzle/0121_fluffy_major_mapleleaf.sql", import.meta.url),
    "utf8",
  );
  db.$client.exec("DROP TRIGGER threads_lifecycle_owner_immutable");
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (
      statement.trimStart().startsWith("UPDATE") ||
      statement.trimStart().startsWith("WITH RECURSIVE")
    )
      db.$client.exec(statement);
  }
  for (const child of [side, worker])
    expect(getThread(db, child.id)).toMatchObject({
      lifecycleOwnerThreadId: owner.id,
      deletedAt: expect.any(Number),
      archivedAt: expect.any(Number),
    });
  expect(getThread(db, unknown.id)).toMatchObject({
    lifecycleOwnerThreadId: null,
    deletedAt: null,
    archivedAt: null,
  });
  expect(db.$client.pragma("foreign_key_check")).toEqual([]);
});
