import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbConnection } from "../../src/connection.js";
import { noopNotifier } from "../../src/notifier.js";
import { pruneClosedSessions } from "../../src/data/sweeps.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { openSession } from "../../src/data/sessions.js";
import { hostDaemonSessions } from "../../src/schema.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  return { db, host, project };
}

describe("pruneClosedSessions", () => {
  function openClosedSessionAt(args: {
    closedAt: number;
    db: DbConnection;
    hostId: string;
    instanceId: string;
  }): string {
    const session = openSession(args.db, {
      hostId: args.hostId,
      instanceId: args.instanceId,
      hostName: "test-host",
      dataDir: "/tmp/test-host-data",
      protocolVersion: 1,
      heartbeatIntervalMs: 10_000,
      leaseTimeoutMs: 30_000,
    });
    args.db
      .update(hostDaemonSessions)
      .set({
        status: "closed",
        closedAt: args.closedAt,
        closeReason: "replaced",
        updatedAt: args.closedAt,
      })
      .where(eq(hostDaemonSessions.id, session.id))
      .run();
    return session.id;
  }

  it("deletes closed sessions older than the threshold", () => {
    const { db, host } = setup();
    const now = Date.now();

    const stale = openClosedSessionAt({
      closedAt: now - 10_000,
      db,
      hostId: host.id,
      instanceId: "inst-stale",
    });
    const fresh = openClosedSessionAt({
      closedAt: now - 1_000,
      db,
      hostId: host.id,
      instanceId: "inst-fresh",
    });
    const active = openSession(db, {
      hostId: host.id,
      instanceId: "inst-active",
      hostName: "test-host",
      dataDir: "/tmp/test-host-data",
      protocolVersion: 1,
      heartbeatIntervalMs: 10_000,
      leaseTimeoutMs: 30_000,
    });

    expect(
      pruneClosedSessions(db, {
        closedBefore: now - 5_000,
        limit: 100,
      }),
    ).toEqual({ deleted: 1 });

    expect(
      db
        .select({ id: hostDaemonSessions.id })
        .from(hostDaemonSessions)
        .all()
        .map((row) => row.id)
        .sort(),
    ).toEqual([fresh, active.id].sort());
    expect(
      db
        .select()
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.id, stale))
        .get(),
    ).toBeUndefined();
  });

  it("never deletes the currently active session", () => {
    const { db, host } = setup();
    const now = Date.now();

    const active = openSession(db, {
      hostId: host.id,
      instanceId: "inst-active",
      hostName: "test-host",
      dataDir: "/tmp/test-host-data",
      protocolVersion: 1,
      heartbeatIntervalMs: 10_000,
      leaseTimeoutMs: 30_000,
    });

    expect(
      pruneClosedSessions(db, {
        closedBefore: now + 60_000,
        limit: 100,
      }),
    ).toEqual({ deleted: 0 });
    expect(
      db
        .select()
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.id, active.id))
        .get()?.status,
    ).toBe("active");
  });

  it("honors the delete batch limit", () => {
    const { db, host } = setup();
    const now = Date.now();
    const closedAt = now - 10_000;

    for (const instanceId of ["inst-a", "inst-b", "inst-c"]) {
      openClosedSessionAt({ closedAt, db, hostId: host.id, instanceId });
    }

    expect(
      pruneClosedSessions(db, {
        closedBefore: now - 5_000,
        limit: 2,
      }),
    ).toEqual({ deleted: 2 });
    expect(
      db
        .select()
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.status, "closed"))
        .all(),
    ).toHaveLength(1);
  });
});
