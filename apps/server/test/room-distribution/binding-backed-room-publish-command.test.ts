import { randomUUID } from "node:crypto";

import {
  createHostId,
  environments,
  getThreadCommandAdmission,
  threads,
} from "@bb/db";
import type { Principal } from "@bb/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBindingBackedRoomDistributionV1 } from "../../src/room-distribution/binding-backed-room-distribution.js";
import type { WorkTogetherRoomChildAttachmentPortV1 } from "../../src/room-distribution/work-together-room-child-attachments.js";
import type { RoomDistributionContextV1 } from "../../src/room-distribution/room-distribution-port.js";
import {
  createWorkTogetherRoomResourceProvisioner,
  type WorkTogetherRoomResourceTarget,
} from "../../src/room-distribution/room-resource-provisioner.js";
import { seedHostSession, seedThreadRuntimeState } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const admitBranchPublish = vi.hoisted(() => vi.fn());

vi.mock("../../src/services/threads/admitted-publish.js", () => ({
  admitBranchPublish: (...args: unknown[]) => admitBranchPublish(...args),
}));

const ALICE: Principal = Object.freeze({
  id: "user_alice_publish",
  kind: "human",
  displayName: "Alice",
});
const BOB: Principal = Object.freeze({
  id: "user_bob_publish",
  kind: "human",
  displayName: "Bob",
});
const NO_CHILDREN: WorkTogetherRoomChildAttachmentPortV1 = Object.freeze({
  attach: async () => {
    throw new Error("unexpected child attachment");
  },
  list: async () => Object.freeze([]),
});
const PRIMARY_STREAM = Object.freeze({ kind: "primary" as const });

function contextFor(
  bindingId: string,
  principal: Principal,
): RoomDistributionContextV1 {
  return Object.freeze({
    bindingId,
    principal,
    authorize: async () => ({ allowed: true as const }),
  });
}

async function provisionIdleRoom(
  harness: TestAppHarness,
  args: {
    principal: Principal;
    seed: number;
  },
) {
  const candidateHostId = randomUUID();
  const { host } = seedHostSession(harness.deps, { id: createHostId() });
  const launch = {
    bindingId: randomUUID(),
    workspaceId: randomUUID(),
    taskId: randomUUID(),
    cellId: randomUUID(),
    repositoryBindingId: randomUUID(),
    repositoryBindingVersion: 1,
    providerRepositoryId: String(args.seed),
    baseBranch: "main",
    baseRevision: "a".repeat(40),
    generatedBranch: `rooms/publish-${args.seed}`,
    candidateHostId,
    environmentTemplate: "managed-worktree" as const,
  };
  const target = {
    bbHostId: host.id,
    projectName: `Room Publish ${args.seed}`,
    providerId: "codex",
    sourcePath: `/srv/work-together/publish-${args.seed}`,
  } satisfies WorkTogetherRoomResourceTarget;
  const provisioned = await createWorkTogetherRoomResourceProvisioner(
    harness.deps,
    {
      resolve: () => target,
    },
  ).provision({ principal: args.principal, launch });

  seedThreadRuntimeState(harness.deps, {
    environmentId: provisioned.environmentId,
    providerThreadId: `provider-publish-${args.seed}`,
    threadId: provisioned.primaryThreadId,
  });
  harness.db
    .update(environments)
    .set({ path: `/tmp/room-publish-${args.seed}`, status: "ready" })
    .where(eq(environments.id, provisioned.environmentId))
    .run();
  harness.db
    .update(threads)
    .set({ status: "idle" })
    .where(eq(threads.id, provisioned.primaryThreadId))
    .run();

  return {
    launch,
    thread: { id: provisioned.primaryThreadId },
    environmentId: provisioned.environmentId,
  };
}

describe("Room branch.publish command", () => {
  beforeEach(() => {
    admitBranchPublish.mockReset();
  });

  it("exposes branch.publish only for owner on idle threads", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionIdleRoom(harness, {
        principal: ALICE,
        seed: 501,
      });
      let policyFacts = {
        role: "owner" as "member" | "owner",
        isTaskAssignee: false,
      };
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        {
          read: async () => ({ id: room.launch.taskId, title: "Ship feature" }),
        },
        NO_CHILDREN,
        { read: async () => ({ ...policyFacts }) },
      );

      await expect(
        distribution.bootstrap(contextFor(room.launch.bindingId, ALICE)),
      ).resolves.toMatchObject({
        capabilities: expect.arrayContaining([
          "message.send",
          "branch.publish",
          "read.mark",
        ]),
      });

      policyFacts = { role: "member", isTaskAssignee: true };
      const memberBootstrap = await distribution.bootstrap(
        contextFor(room.launch.bindingId, BOB),
      );
      expect(memberBootstrap.capabilities).toContain("message.send");
      expect(memberBootstrap.capabilities).not.toContain("branch.publish");

      harness.db
        .update(threads)
        .set({ status: "active" })
        .where(eq(threads.id, room.thread.id))
        .run();
      policyFacts = { role: "owner", isTaskAssignee: false };
      const activeBootstrap = await distribution.bootstrap(
        contextFor(room.launch.bindingId, ALICE),
      );
      expect(activeBootstrap.capabilities).toContain("message.send");
      expect(activeBootstrap.capabilities).not.toContain("branch.publish");
    });
  });

  it("rejects non-owner and non-idle execute with unavailable", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionIdleRoom(harness, {
        principal: ALICE,
        seed: 502,
      });
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        {
          read: async () => ({ id: room.launch.taskId, title: "Ship feature" }),
        },
        NO_CHILDREN,
        {
          read: async ({ principal }) =>
            principal.id === ALICE.id
              ? { role: "owner", isTaskAssignee: false }
              : { role: "member", isTaskAssignee: true },
        },
      );

      await expect(
        distribution.execute(contextFor(room.launch.bindingId, BOB), {
          kind: "branch.publish",
          requestId: "creq_23456789pa",
          stream: PRIMARY_STREAM,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      expect(admitBranchPublish).not.toHaveBeenCalled();

      harness.db
        .update(threads)
        .set({ status: "active" })
        .where(eq(threads.id, room.thread.id))
        .run();
      await expect(
        distribution.execute(contextFor(room.launch.bindingId, ALICE), {
          kind: "branch.publish",
          requestId: "creq_23456789pb",
          stream: PRIMARY_STREAM,
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      expect(admitBranchPublish).not.toHaveBeenCalled();
    });
  });

  it("decodes optional title/body and returns the published receipt result", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionIdleRoom(harness, {
        principal: ALICE,
        seed: 503,
      });
      admitBranchPublish.mockResolvedValue({
        kind: "accepted",
        admission: {
          threadId: room.thread.id,
          requestId: "creq_23456789pc",
          commandKind: "branch.publish",
          requestFingerprint: `sha256:${"c".repeat(64)}`,
          admissionSequence: 1,
          actor: {
            principalId: ALICE.id,
            principalKind: ALICE.kind,
            displayName: ALICE.displayName,
          },
          result: {
            disposition: "published",
            provider: "github",
            prNumber: 22,
            prUrl: "https://github.com/org/repo/pull/22",
            commitSha: "cafe1234",
          },
          createdAt: 1_000,
          completedAt: 1_000,
        },
      });
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        {
          read: async () => ({ id: room.launch.taskId, title: "Ship feature" }),
        },
        NO_CHILDREN,
        { read: async () => ({ role: "owner", isTaskAssignee: false }) },
      );

      const response = await distribution.execute(
        contextFor(room.launch.bindingId, ALICE),
        {
          kind: "branch.publish",
          requestId: "creq_23456789pc",
          title: "Custom title",
          body: "Custom body",
          stream: PRIMARY_STREAM,
        },
      );

      expect(response).toMatchObject({
        status: 202,
        body: {
          schemaVersion: 2,
          outcome: "accepted",
          commandKind: "branch.publish",
          result: {
            disposition: "published",
            provider: "github",
            prNumber: 22,
            prUrl: "https://github.com/org/repo/pull/22",
            commitSha: "cafe1234",
          },
          stream: PRIMARY_STREAM,
        },
      });
      expect(admitBranchPublish).toHaveBeenCalledWith(
        harness.deps,
        expect.objectContaining({
          defaultTitle: "Ship feature",
          payload: {
            requestId: "creq_23456789pc",
            title: "Custom title",
            body: "Custom body",
          },
        }),
      );
    });
  });

  it("maps no_changes to a clean rejection receipt", async () => {
    await withTestHarness(async (harness) => {
      const room = await provisionIdleRoom(harness, {
        principal: ALICE,
        seed: 504,
      });
      const { ApiError } = await import("../../src/errors.js");
      admitBranchPublish.mockRejectedValue(
        new ApiError(409, "no_changes", "No commits to push"),
      );
      const distribution = createBindingBackedRoomDistributionV1(
        harness.deps,
        {
          read: async () => ({ id: room.launch.taskId, title: "Ship feature" }),
        },
        NO_CHILDREN,
        { read: async () => ({ role: "owner", isTaskAssignee: false }) },
      );

      await expect(
        distribution.execute(contextFor(room.launch.bindingId, ALICE), {
          kind: "branch.publish",
          requestId: "creq_23456789pd",
          stream: PRIMARY_STREAM,
        }),
      ).resolves.toMatchObject({
        status: 200,
        body: {
          schemaVersion: 2,
          outcome: "rejected",
          commandKind: "branch.publish",
          reason: "no_changes",
          stream: PRIMARY_STREAM,
        },
      });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: room.thread.id,
          requestId: "creq_23456789pd",
        }),
      ).toBeNull();
    });
  });
});
