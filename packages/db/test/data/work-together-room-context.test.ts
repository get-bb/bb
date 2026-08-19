import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  admitWorkTogetherRoomContext,
  createConnection,
  createProject,
  createThread,
  getWorkTogetherRoomContext,
  getWorkTogetherRoomContextApplyBytes,
  getWorkTogetherRoomStreamContext,
  inheritWorkTogetherRoomContextForChild,
  migrate,
  reserveWorkTogetherRoomResources,
  upsertHost,
  WorkTogetherRoomStreamContextConflictError,
} from "../../src/index.js";
import { noopNotifier } from "../../src/notifier.js";

function digestOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function reserveScratch(
  db: ReturnType<typeof createConnection>,
  cellId: string,
  bindingId = randomUUID(),
) {
  return reserveWorkTogetherRoomResources(db, {
    bindingId,
    workspaceId: randomUUID(),
    taskId: randomUUID(),
    cellId,
    candidateHostId: randomUUID(),
    workKind: "code",
    environmentTemplate: "isolated-scratch",
  });
}

function setupRoomDb() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "wt-room-context-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "wt-room-context-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/wt-room-context" },
  });
  return { db, project };
}

describe("Work Together Room context applies", () => {
  it("persists exact replays and isolates bindings that share a cell", () => {
    const db = createConnection(":memory:");
    migrate(db);
    try {
      const cellId = randomUUID();
      const firstBinding = randomUUID();
      const secondBinding = randomUUID();
      for (const bindingId of [firstBinding, secondBinding]) {
        reserveWorkTogetherRoomResources(db, {
          bindingId,
          workspaceId: randomUUID(),
          taskId: randomUUID(),
          cellId,
          candidateHostId: randomUUID(),
          workKind: "code",
          environmentTemplate: "isolated-scratch",
        });
      }
      const bytes = Buffer.from("opaque context", "utf8");
      const digest = "a".repeat(64);
      const accepted = admitWorkTogetherRoomContext(db, {
        bindingId: firstBinding,
        requestId: "creq_23456789context",
        contextVersion: 4,
        digest,
        bytes,
        nowMs: 1_700_000_000_000,
      });
      expect(accepted).toMatchObject({
        kind: "accepted",
        apply: { contextVersion: 4, digest, admissionSequence: 1, bytes },
      });
      const replay = admitWorkTogetherRoomContext(db, {
        bindingId: firstBinding,
        requestId: "creq_23456789context",
        contextVersion: 4,
        digest,
        bytes,
        nowMs: 1_700_000_000_100,
      });
      expect(replay).toEqual({ ...accepted, kind: "replayed" });
      expect(getWorkTogetherRoomContext(db, firstBinding)).toEqual({
        version: 4,
        digest,
      });
      expect(getWorkTogetherRoomContext(db, secondBinding)).toBeNull();
      expect(
        admitWorkTogetherRoomContext(db, {
          bindingId: firstBinding,
          requestId: "creq_23456789newvers",
          contextVersion: 4,
          digest,
          bytes,
          nowMs: 1_700_000_000_200,
        }),
      ).toEqual({ kind: "conflict" });
    } finally {
      db.$client.close();
    }
  });
});

describe("Work Together Room child context inherit", () => {
  it("captures the Room current pair and exact apply bytes for a child", () => {
    const { db, project } = setupRoomDb();
    try {
      const cellId = randomUUID();
      const reservation = reserveScratch(db, cellId);
      const bytes = Buffer.from("room-current-v2", "utf8");
      const digest = digestOf(bytes);
      expect(
        admitWorkTogetherRoomContext(db, {
          bindingId: reservation.bindingId,
          requestId: "creq_23456789v1",
          contextVersion: 1,
          digest: digestOf(Buffer.from("older", "utf8")),
          bytes: Buffer.from("older", "utf8"),
          nowMs: 1,
        }).kind,
      ).toBe("accepted");
      expect(
        admitWorkTogetherRoomContext(db, {
          bindingId: reservation.bindingId,
          requestId: "creq_23456789v2",
          contextVersion: 2,
          digest,
          bytes,
          nowMs: 2,
        }).kind,
      ).toBe("accepted");

      const child = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const inherited = inheritWorkTogetherRoomContextForChild(db, {
        bindingId: reservation.bindingId,
        threadId: child.id,
        nowMs: 3,
      });
      expect(inherited).toEqual({ version: 2, digest });
      expect(getWorkTogetherRoomStreamContext(db, child.id)).toEqual({
        bindingId: reservation.bindingId,
        version: 2,
        digest,
      });
      expect(
        getWorkTogetherRoomContextApplyBytes(db, {
          bindingId: reservation.bindingId,
          contextVersion: 2,
        }),
      ).toEqual({ digest, bytes });
    } finally {
      db.$client.close();
    }
  });

  it("is a no-op when the Room has no applied context", () => {
    const { db, project } = setupRoomDb();
    try {
      const reservation = reserveScratch(db, randomUUID());
      const child = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      expect(
        inheritWorkTogetherRoomContextForChild(db, {
          bindingId: reservation.bindingId,
          threadId: child.id,
          nowMs: 1,
        }),
      ).toBeNull();
      expect(getWorkTogetherRoomStreamContext(db, child.id)).toBeNull();
    } finally {
      db.$client.close();
    }
  });

  it("refuses a second inherit for the same thread (no silent overwrite)", () => {
    const { db, project } = setupRoomDb();
    try {
      const reservation = reserveScratch(db, randomUUID());
      const bytes = Buffer.from("once", "utf8");
      const digest = digestOf(bytes);
      admitWorkTogetherRoomContext(db, {
        bindingId: reservation.bindingId,
        requestId: "creq_23456789once",
        contextVersion: 1,
        digest,
        bytes,
        nowMs: 1,
      });
      const child = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      expect(
        inheritWorkTogetherRoomContextForChild(db, {
          bindingId: reservation.bindingId,
          threadId: child.id,
          nowMs: 2,
        }),
      ).toEqual({ version: 1, digest });
      expect(() =>
        inheritWorkTogetherRoomContextForChild(db, {
          bindingId: reservation.bindingId,
          threadId: child.id,
          nowMs: 3,
        }),
      ).toThrow(WorkTogetherRoomStreamContextConflictError);
      expect(getWorkTogetherRoomStreamContext(db, child.id)).toEqual({
        bindingId: reservation.bindingId,
        version: 1,
        digest,
      });
    } finally {
      db.$client.close();
    }
  });

  it("keeps the child pair when Primary later applies a newer version", () => {
    const { db, project } = setupRoomDb();
    try {
      const reservation = reserveScratch(db, randomUUID());
      const firstBytes = Buffer.from("v1", "utf8");
      const firstDigest = digestOf(firstBytes);
      admitWorkTogetherRoomContext(db, {
        bindingId: reservation.bindingId,
        requestId: "creq_23456789keep1",
        contextVersion: 1,
        digest: firstDigest,
        bytes: firstBytes,
        nowMs: 1,
      });
      const child = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      inheritWorkTogetherRoomContextForChild(db, {
        bindingId: reservation.bindingId,
        threadId: child.id,
        nowMs: 2,
      });

      const secondBytes = Buffer.from("v2-refresh", "utf8");
      const secondDigest = digestOf(secondBytes);
      expect(
        admitWorkTogetherRoomContext(db, {
          bindingId: reservation.bindingId,
          requestId: "creq_23456789keep2",
          contextVersion: 2,
          digest: secondDigest,
          bytes: secondBytes,
          nowMs: 3,
        }).kind,
      ).toBe("accepted");
      expect(getWorkTogetherRoomContext(db, reservation.bindingId)).toEqual({
        version: 2,
        digest: secondDigest,
      });
      expect(getWorkTogetherRoomStreamContext(db, child.id)).toEqual({
        bindingId: reservation.bindingId,
        version: 1,
        digest: firstDigest,
      });
      expect(
        getWorkTogetherRoomContextApplyBytes(db, {
          bindingId: reservation.bindingId,
          contextVersion: 1,
        }),
      ).toEqual({ digest: firstDigest, bytes: firstBytes });
    } finally {
      db.$client.close();
    }
  });

  it("isolates inherits across bindings that share one Goal cell", () => {
    const { db, project } = setupRoomDb();
    try {
      const cellId = randomUUID();
      const first = reserveScratch(db, cellId);
      const second = reserveScratch(db, cellId);
      const firstBytes = Buffer.from("binding-a", "utf8");
      const secondBytes = Buffer.from("binding-b", "utf8");
      const firstDigest = digestOf(firstBytes);
      const secondDigest = digestOf(secondBytes);
      admitWorkTogetherRoomContext(db, {
        bindingId: first.bindingId,
        requestId: "creq_23456789isola",
        contextVersion: 3,
        digest: firstDigest,
        bytes: firstBytes,
        nowMs: 1,
      });
      admitWorkTogetherRoomContext(db, {
        bindingId: second.bindingId,
        requestId: "creq_23456789isolb",
        contextVersion: 7,
        digest: secondDigest,
        bytes: secondBytes,
        nowMs: 2,
      });

      const childA = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const childB = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      expect(
        inheritWorkTogetherRoomContextForChild(db, {
          bindingId: first.bindingId,
          threadId: childA.id,
          nowMs: 3,
        }),
      ).toEqual({ version: 3, digest: firstDigest });
      expect(
        inheritWorkTogetherRoomContextForChild(db, {
          bindingId: second.bindingId,
          threadId: childB.id,
          nowMs: 4,
        }),
      ).toEqual({ version: 7, digest: secondDigest });

      expect(getWorkTogetherRoomStreamContext(db, childA.id)).toEqual({
        bindingId: first.bindingId,
        version: 3,
        digest: firstDigest,
      });
      expect(getWorkTogetherRoomStreamContext(db, childB.id)).toEqual({
        bindingId: second.bindingId,
        version: 7,
        digest: secondDigest,
      });
      expect(
        getWorkTogetherRoomContextApplyBytes(db, {
          bindingId: first.bindingId,
          contextVersion: 3,
        })?.bytes.equals(firstBytes),
      ).toBe(true);
      expect(
        getWorkTogetherRoomContextApplyBytes(db, {
          bindingId: second.bindingId,
          contextVersion: 7,
        })?.bytes.equals(secondBytes),
      ).toBe(true);
      expect(
        getWorkTogetherRoomContextApplyBytes(db, {
          bindingId: first.bindingId,
          contextVersion: 7,
        }),
      ).toBeNull();
    } finally {
      db.$client.close();
    }
  });
});
