import { createHash, randomUUID } from "node:crypto";

import { createHostId } from "@bb/db";
import type { Principal } from "@bb/domain";
import { describe, expect, it } from "vitest";

import { createBindingBackedRoomDistributionV1 } from "../../src/room-distribution/binding-backed-room-distribution.js";
import {
  createWorkTogetherRoomResourceProvisioner,
  type WorkTogetherRoomResourceTarget,
} from "../../src/room-distribution/room-resource-provisioner.js";
import type { RoomDistributionContextV1 } from "../../src/room-distribution/room-distribution-port.js";
import type { WorkTogetherRoomChildAttachmentPortV1 } from "../../src/room-distribution/work-together-room-child-attachments.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const ALICE: Principal = Object.freeze({
  id: "user_alice_context_apply",
  kind: "human",
  displayName: "Alice",
});
const NO_CHILDREN: WorkTogetherRoomChildAttachmentPortV1 = Object.freeze({
  attach: async () => {
    throw new Error("unexpected child attachment");
  },
  list: async () => Object.freeze([]),
});
const PRIMARY_STREAM = Object.freeze({ kind: "primary" as const });
const RECEIPT_KEYS = [
  "admissionSequence",
  "commandKind",
  "completedAt",
  "createdAt",
  "outcome",
  "requestId",
  "result",
  "schemaVersion",
  "stream",
] as const;

function contextFor(bindingId: string): RoomDistributionContextV1 {
  return Object.freeze({
    bindingId,
    principal: ALICE,
    authorize: async () => ({ allowed: true as const }),
  });
}

function target(
  harness: TestAppHarness,
  seed: number,
): WorkTogetherRoomResourceTarget {
  const { host } = seedHostSession(harness.deps, { id: createHostId() });
  return {
    bbHostId: host.id,
    dataDir: `/tmp/bb-host-data/${host.id}`,
    projectName: `Room Context ${seed}`,
    providerId: "codex",
    sourcePath: `/srv/work-together/context-${seed}`,
  };
}

function distribution(harness: TestAppHarness) {
  return createBindingBackedRoomDistributionV1(
    harness.deps,
    { read: async () => ({ title: "Context task" }) },
    NO_CHILDREN,
    { read: async () => ({ role: "member", isTaskAssignee: false }) },
  );
}

function opaqueEnvelope(text: string) {
  const bytes = Buffer.from(text, "utf8");
  return {
    bytes,
    digest: createHash("sha256").update(bytes).digest("hex"),
    bytesBase64: bytes.toString("base64"),
  };
}

describe("Room context.apply command", () => {
  it("accepts, replays, isolates bindings, and rejects non-monotonic versions", async () => {
    await withTestHarness(async (harness) => {
      const cellId = randomUUID();
      const firstLaunch = {
        bindingId: randomUUID(),
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        cellId,
        workKind: "conversation" as const,
        candidateHostId: randomUUID(),
        environmentTemplate: "isolated-scratch" as const,
      };
      const secondLaunch = {
        bindingId: randomUUID(),
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        cellId,
        workKind: "conversation" as const,
        candidateHostId: randomUUID(),
        environmentTemplate: "isolated-scratch" as const,
      };
      const firstTarget = target(harness, 701);
      const secondTarget = target(harness, 702);
      await createWorkTogetherRoomResourceProvisioner(harness.deps, {
        resolveHost: () => firstTarget,
        resolve: () => firstTarget,
      }).provision({ principal: ALICE, launch: firstLaunch });
      await createWorkTogetherRoomResourceProvisioner(harness.deps, {
        resolveHost: () => secondTarget,
        resolve: () => secondTarget,
      }).provision({ principal: ALICE, launch: secondLaunch });
      const room = distribution(harness);
      const envelope = opaqueEnvelope("goal snapshot v4");
      const command = {
        kind: "context.apply",
        requestId: "creq_23456789ca",
        stream: PRIMARY_STREAM,
        contextVersion: 4,
        digest: envelope.digest,
        bytesBase64: envelope.bytesBase64,
      };

      const before = await room.bootstrap(contextFor(firstLaunch.bindingId));
      expect(before.context).toBeNull();
      expect(before.capabilities).toContain("context.apply");
      expect(JSON.stringify(before)).not.toContain(envelope.bytesBase64);

      const accepted = await room.execute(
        contextFor(firstLaunch.bindingId),
        command,
      );
      expect(accepted.status).toBe(202);
      expect(Object.keys(accepted.body).sort()).toEqual([...RECEIPT_KEYS].sort());
      expect(accepted.body).toMatchObject({
        schemaVersion: 2,
        outcome: "accepted",
        requestId: command.requestId,
        commandKind: "context.apply",
        admissionSequence: 1,
        stream: PRIMARY_STREAM,
        result: {
          disposition: "context-applied",
          contextVersion: 4,
          digest: envelope.digest,
        },
      });
      expect(accepted.body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
      expect(accepted.body.completedAt).toBe(accepted.body.createdAt);
      expect(JSON.stringify(accepted.body)).not.toContain(envelope.bytesBase64);

      const replay = await room.execute(
        contextFor(firstLaunch.bindingId),
        command,
      );
      expect(replay).toEqual({
        status: 200,
        body: { ...accepted.body, outcome: "already-accepted" },
      });

      const changed = opaqueEnvelope("changed payload");
      await expect(
        room.execute(contextFor(firstLaunch.bindingId), {
          ...command,
          digest: changed.digest,
          bytesBase64: changed.bytesBase64,
        }),
      ).resolves.toMatchObject({
        status: 409,
        body: { code: "conflict" },
      });

      await expect(
        room.execute(contextFor(firstLaunch.bindingId), {
          ...command,
          requestId: "creq_23456789cb",
          contextVersion: 4,
        }),
      ).resolves.toMatchObject({
        status: 409,
        body: { code: "conflict" },
      });

      const after = await room.bootstrap(contextFor(firstLaunch.bindingId));
      expect(after.context).toEqual({
        version: 4,
        digest: envelope.digest,
      });
      expect(JSON.stringify(after)).not.toContain(envelope.bytesBase64);

      const sibling = await room.bootstrap(contextFor(secondLaunch.bindingId));
      expect(sibling.context).toBeNull();
    });
  });

  it("rejects invalid apply shapes before admission", async () => {
    await withTestHarness(async (harness) => {
      const launch = {
        bindingId: randomUUID(),
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        cellId: randomUUID(),
        workKind: "conversation" as const,
        candidateHostId: randomUUID(),
        environmentTemplate: "isolated-scratch" as const,
      };
      const scratchTarget = target(harness, 703);
      await createWorkTogetherRoomResourceProvisioner(harness.deps, {
        resolveHost: () => scratchTarget,
        resolve: () => scratchTarget,
      }).provision({ principal: ALICE, launch });
      const room = distribution(harness);
      const envelope = opaqueEnvelope("strict decoder");

      await expect(
        room.execute(contextFor(launch.bindingId), {
          kind: "context.apply",
          requestId: "creq_23456789cc",
          stream: { kind: "subagent", id: randomUUID() },
          contextVersion: 1,
          digest: envelope.digest,
          bytesBase64: envelope.bytesBase64,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });

      await expect(
        room.execute(contextFor(launch.bindingId), {
          kind: "context.apply",
          requestId: "creq_23456789cd",
          stream: PRIMARY_STREAM,
          contextVersion: 1,
          digest: "A".repeat(64),
          bytesBase64: envelope.bytesBase64,
        }),
      ).rejects.toMatchObject({
        status: 400,
        body: { code: "invalid_request" },
      });

      await expect(
        room.execute(contextFor(launch.bindingId), {
          kind: "context.apply",
          requestId: "creq_23456789ce",
          stream: PRIMARY_STREAM,
          contextVersion: 1,
          digest: "c".repeat(64),
          bytesBase64: envelope.bytesBase64,
        }),
      ).rejects.toMatchObject({
        status: 400,
        body: { code: "invalid_request" },
      });

      await expect(
        room.execute(contextFor(launch.bindingId), {
          kind: "context.apply",
          requestId: "creq_23456789cf",
          stream: PRIMARY_STREAM,
          contextVersion: 1,
          digest: envelope.digest,
          bytesBase64: envelope.bytesBase64,
          extra: true,
        }),
      ).rejects.toMatchObject({
        status: 400,
        body: { code: "invalid_request" },
      });
    });
  });
});
