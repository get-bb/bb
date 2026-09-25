import { describe, expect, it } from "vitest";
import { turnScope } from "@bb/domain";
import { eq } from "drizzle-orm";
import { insertEvents } from "../../src/data/events.js";
import { threads } from "../../src/schema.js";
import { noopNotifier } from "../../src/notifier.js";
import { createEnvironment } from "../../src/data/environments.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  archiveThread,
  createThread,
  listRunningThreads,
  markThreadDeleted,
} from "../../src/data/threads.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

function setup() {
  const db = createMigratedConnection();
  const hostA = upsertHost(db, noopNotifier, {
    name: "host-a",
  });
  const hostB = upsertHost(db, noopNotifier, {
    name: "host-b",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "project-a",
    source: { type: "local_path", hostId: hostA.id, path: "/tmp/a" },
  });
  const environmentA = createEnvironment(db, noopNotifier, {
      providerOwnsPath: false,
    hostId: hostA.id,
    projectId: project.id,
    path: "/tmp/a",
  });
  const environmentB = createEnvironment(db, noopNotifier, {
      providerOwnsPath: false,
    hostId: hostB.id,
    projectId: project.id,
    path: "/tmp/b",
  });
  return { db, environmentA, environmentB, hostA, hostB, project };
}

describe("listRunningThreads", () => {
  it("reports provider, model, status, and when the current run began", () => {
    const { db, environmentA, project } = setup();
    const active = createThread(db, noopNotifier, {
      environmentId: environmentA.id,
      projectId: project.id,
      providerId: "codex",
      status: "active",
    });
    const starting = createThread(db, noopNotifier, {
      environmentId: environmentA.id,
      projectId: project.id,
      providerId: "claude-code",
      status: "starting",
    });
    db.update(threads).set({ modelOverride: "gpt-5", updatedAt: 1_000 }).where(eq(threads.id, active.id)).run();
    db.update(threads).set({ updatedAt: 2_000 }).where(eq(threads.id, starting.id)).run();
    const turnStarted = (threadId: string, sequence: number, createdAt: number, parentToolCallId: string | null) => ({
      threadId,
      scope: turnScope(`turn-${sequence}`),
      sequence,
      type: "turn/started" as const,
      itemId: null,
      itemKind: null,
      parentToolCallId,
      createdAt,
      data: "{}",
    });
    insertEvents(db, noopNotifier, [
      turnStarted(active.id, 1, 5_000, null),
      turnStarted(active.id, 2, 7_000, null),
      turnStarted(active.id, 3, 9_000, "tool-call"),
      turnStarted(starting.id, 1, 8_000, null),
    ]);

    expect(listRunningThreads(db).sort((left, right) => left.providerId.localeCompare(right.providerId))).toEqual([
      expect.objectContaining({ id: starting.id, providerId: "claude-code", model: null, status: "starting", runningSince: 2_000 }),
      expect.objectContaining({ id: active.id, providerId: "codex", model: "gpt-5", status: "active", runningSince: 7_000 }),
    ]);
  });

  it("returns only the statuses that occupy capacity", () => {
    const { db, environmentA, project } = setup();
    const ids = new Map<string, string>();
    for (const status of [
      "pending",
      "idle",
      "starting",
      "active",
      "stopping",
      "error",
    ] as const) {
      ids.set(
        status,
        createThread(db, noopNotifier, {
          environmentId: environmentA.id,
          projectId: project.id,
          providerId: "codex",
          status,
        }).id,
      );
    }

    // `idle` is the one that is easy to get wrong: the thread has a live
    // session but is consuming nothing, so it holds no slot.
    expect(listRunningThreads(db).map((row) => row.id).sort()).toEqual(
      [ids.get("starting")!, ids.get("active")!].sort(),
    );
  });

  it("excludes archived and deleted threads but keeps hidden ones", () => {
    const { db, environmentA, project } = setup();
    const make = (visibility: "visible" | "hidden" = "visible") =>
      createThread(db, noopNotifier, {
        environmentId: environmentA.id,
        projectId: project.id,
        providerId: "codex",
        status: "active",
        visibility,
      });
    const live = make();
    const hidden = make("hidden");
    const archived = make();
    const deleted = make();
    archiveThread(db, noopNotifier, archived.id);
    markThreadDeleted(db, noopNotifier, { threadId: deleted.id });

    // A hidden thread burns a real slot on a real machine, so hiding it here
    // would under-report occupancy; archival and deletion actually stop one.
    expect(listRunningThreads(db).map((row) => row.id).sort()).toEqual(
      [live.id, hidden.id].sort(),
    );
  });

  it("resolves the host through the thread's environment, null when it has none", () => {
    const { db, environmentA, environmentB, hostA, hostB, project } = setup();
    const onA = createThread(db, noopNotifier, {
      environmentId: environmentA.id,
      projectId: project.id,
      providerId: "codex",
      status: "active",
    });
    const onB = createThread(db, noopNotifier, {
      environmentId: environmentB.id,
      projectId: project.id,
      providerId: "codex",
      status: "starting",
    });
    // A thread admitted but not yet provisioned: counts globally, on no host.
    const unplaced = createThread(db, noopNotifier, {
      environmentId: null,
      projectId: project.id,
      providerId: "codex",
      status: "starting",
    });

    const byId = new Map(
      listRunningThreads(db).map((row) => [row.id, row.hostId]),
    );
    expect(byId.get(onA.id)).toBe(hostA.id);
    expect(byId.get(onB.id)).toBe(hostB.id);
    expect(byId.get(unplaced.id)).toBeNull();
  });

  it("counts child and plugin-spawned threads like any other", () => {
    // Occupancy is about slots, not provenance: a child thread and a
    // plugin-spawned one each burn a real slot on a real machine, so a row
    // that hid them would under-report what is running.
    const { db, environmentA, project } = setup();
    const parent = createThread(db, noopNotifier, {
      environmentId: environmentA.id,
      projectId: project.id,
      providerId: "codex",
      status: "active",
    });
    const child = createThread(db, noopNotifier, {
      environmentId: environmentA.id,
      projectId: project.id,
      providerId: "codex",
      status: "active",
      parentThreadId: parent.id,
    });
    const spawned = createThread(db, noopNotifier, {
      environmentId: environmentA.id,
      projectId: project.id,
      providerId: "codex",
      status: "active",
      originPluginId: "workflows",
    });

    expect(listRunningThreads(db).map((row) => row.id).sort()).toEqual(
      [parent.id, child.id, spawned.id].sort(),
    );
  });
});
