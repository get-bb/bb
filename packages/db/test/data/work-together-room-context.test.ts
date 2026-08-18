import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  admitWorkTogetherRoomContext,
  createConnection,
  getWorkTogetherRoomContext,
  migrate,
  reserveWorkTogetherRoomResources,
} from "../../src/index.js";

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
