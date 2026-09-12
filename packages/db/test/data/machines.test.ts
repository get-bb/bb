import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { eq } from "drizzle-orm";
import { createEnvironment } from "../../src/data/environments.js";
import { updateHost, upsertHost } from "../../src/data/hosts.js";
import {
  machineHasLiveThreadLaunch,
  machineHasPendingThreads,
  machineHasProvisioningEnvironment,
  machineHasStartingThreadLaunch,
} from "../../src/data/machines.js";
import { createProject } from "../../src/data/projects.js";
import { archiveThread, createThread } from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import { environments, threads } from "../../src/schema.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  return { db, host, project };
}

describe("machine provisioning state", () => {
  it("distinguishes starting launches from live threads retained until archive", () => {
    const { db, host, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "starting",
    });
    updateHost(db, noopNotifier, host.id, { launchKey: thread.id });

    expect(machineHasLiveThreadLaunch(db, host.id)).toBe(true);
    expect(machineHasStartingThreadLaunch(db, host.id)).toBe(true);
    for (const status of ["active", "idle", "error"] as const) {
      db.update(threads).set({ status }).where(eq(threads.id, thread.id)).run();
      expect(machineHasStartingThreadLaunch(db, host.id)).toBe(false);
      expect(machineHasLiveThreadLaunch(db, host.id)).toBe(true);
    }
    archiveThread(db, noopNotifier, thread.id);
    expect(machineHasLiveThreadLaunch(db, host.id)).toBe(false);
    expect(machineHasStartingThreadLaunch(db, host.id)).toBe(false);
  });

  it("finds a provisioning environment on the host until it is ready", () => {
    const { db, host, project } = setup();
    const environment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/environment",
      providerOwnsPath: false,
      status: "provisioning",
      environmentProvider: null,
    });

    expect(machineHasProvisioningEnvironment(db, host.id)).toBe(true);
    db.update(environments)
      .set({ status: "ready" })
      .where(eq(environments.id, environment.id))
      .run();
    expect(machineHasProvisioningEnvironment(db, host.id)).toBe(false);
  });
});

describe("pending machine ownership", () => {
  it.each(["pending", "provisioning"] as const)(
    "retains persisted %s placement after reloading the database",
    (kind) => {
      const { db, host, project } = setup();
      try {
        const thread = createThread(db, noopNotifier, {
          projectId: project.id,
          providerId: "codex",
          status: kind === "pending" ? "pending" : "starting",
        });
        const environmentIntent = {
          type: "provider",
          machine: { type: "existing", hostId: host.id },
        };
        db.update(threads)
          .set({
            startupContext: JSON.stringify(
              kind === "pending"
                ? { kind, environmentIntent }
                : { kind, request: { environmentIntent } },
            ),
          })
          .where(eq(threads.id, thread.id))
          .run();
        const restored = createConnection(db.$client.serialize());
        try {
          expect(machineHasPendingThreads(restored, host.id)).toBe(true);
          expect(machineHasPendingThreads(restored, "different-host")).toBe(
            false,
          );
          for (const patch of [
            { status: "error" },
            { status: "idle" },
            { archivedAt: 1 },
            { deletedAt: 1 },
          ] as const) {
            restored
              .update(threads)
              .set({
                status: kind === "pending" ? "pending" : "starting",
                archivedAt: null,
                deletedAt: null,
                ...patch,
              })
              .where(eq(threads.id, thread.id))
              .run();
            expect(machineHasPendingThreads(restored, host.id)).toBe(false);
          }
        } finally {
          restored.$client.close();
        }
      } finally {
        db.$client.close();
      }
    },
  );

  it("retains a preparing owner through ready-before-attachment but releases orphan or cancelled preparation", () => {
    const { db, host, project } = setup();
    try {
      const thread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
        status: "starting",
      });
      const environment = createEnvironment(db, noopNotifier, {
        projectId: project.id,
        hostId: host.id,
        path: "/tmp/preparing",
        status: "provisioning",
        providerOwnsPath: false,
        environmentProvider: null,
      });
      db.update(environments)
        .set({ ownerThreadId: thread.id })
        .where(eq(environments.id, environment.id))
        .run();
      for (const status of ["creating", "provisioning", "ready"] as const) {
        db.update(environments)
          .set({ status })
          .where(eq(environments.id, environment.id))
          .run();
        expect(machineHasPendingThreads(db, host.id)).toBe(true);
      }
      db.update(environments)
        .set({ teardownStatus: "running" })
        .where(eq(environments.id, environment.id))
        .run();
      expect(machineHasPendingThreads(db, host.id)).toBe(false);
      db.update(environments)
        .set({ teardownStatus: null })
        .where(eq(environments.id, environment.id))
        .run();
      for (const patch of [
        { status: "pending" },
        { status: "error" },
        { status: "idle" },
        { archivedAt: 1 },
        { deletedAt: 1 },
      ] as const) {
        db.update(threads)
          .set({
            status: "starting",
            archivedAt: null,
            deletedAt: null,
            ...patch,
          })
          .where(eq(threads.id, thread.id))
          .run();
        expect(machineHasPendingThreads(db, host.id)).toBe(false);
      }
      db.delete(threads).where(eq(threads.id, thread.id)).run();
      expect(machineHasPendingThreads(db, host.id)).toBe(false);
    } finally {
      db.$client.close();
    }
  });

  it("finds an unattached pending reuse intent without retaining failed or destroyed workspaces", () => {
    const { db, host, project } = setup();
    try {
      const environment = createEnvironment(db, noopNotifier, {
        projectId: project.id,
        hostId: host.id,
        path: "/tmp/reuse",
        status: "ready",
        providerOwnsPath: false,
        environmentProvider: null,
      });
      const thread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
        status: "pending",
      });
      db.update(threads)
        .set({
          startupContext: JSON.stringify({
            kind: "pending",
            environmentIntent: { type: "reuse", environmentId: environment.id },
          }),
        })
        .where(eq(threads.id, thread.id))
        .run();
      expect(machineHasPendingThreads(db, host.id)).toBe(true);
      const oldHost = upsertHost(db, noopNotifier, { name: "previous-host" });
      const oldEnvironment = createEnvironment(db, noopNotifier, {
        projectId: project.id,
        hostId: oldHost.id,
        path: "/tmp/old",
        status: "ready",
        providerOwnsPath: false,
        environmentProvider: null,
      });
      db.update(environments)
        .set({ ownerThreadId: thread.id })
        .where(eq(environments.id, oldEnvironment.id))
        .run();
      expect(machineHasPendingThreads(db, oldHost.id)).toBe(false);
      for (const status of ["error", "destroyed"] as const) {
        db.update(environments)
          .set({ status })
          .where(eq(environments.id, environment.id))
          .run();
        expect(machineHasPendingThreads(db, host.id)).toBe(false);
      }
    } finally {
      db.$client.close();
    }
  });
});
