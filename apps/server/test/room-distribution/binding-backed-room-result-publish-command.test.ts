import { randomUUID } from "node:crypto";

import { createHostId, getThreadCommandAdmission } from "@bb/db";
import type { Principal } from "@bb/domain";
import { describe, expect, it } from "vitest";

import { createBindingBackedRoomDistributionV1 } from "../../src/room-distribution/binding-backed-room-distribution.js";
import {
  createWorkTogetherRoomResourceProvisioner,
  type WorkTogetherRoomResourceTarget,
} from "../../src/room-distribution/room-resource-provisioner.js";
import type { RoomDistributionContextV1 } from "../../src/room-distribution/room-distribution-port.js";
import type { WorkTogetherRoomChildAttachmentPortV1 } from "../../src/room-distribution/work-together-room-child-attachments.js";
import { parseWorkResultSubmission } from "../../src/services/threads/work-result-submission.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const ALICE: Principal = Object.freeze({
  id: "user_alice_result_publish",
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
    projectName: `Room Result ${seed}`,
    providerId: "codex",
    sourcePath: `/srv/work-together/result-${seed}`,
  };
}

function distribution(harness: TestAppHarness) {
  return createBindingBackedRoomDistributionV1(
    harness.deps,
    { read: async () => ({ title: "Result task" }) },
    NO_CHILDREN,
    { read: async () => ({ role: "member", isTaskAssignee: false }) },
  );
}

function submission(
  kind: "conversation" | "research" | "code",
  summary: string,
) {
  return {
    schemaVersion: 1,
    kind,
    summary,
    decisions: [{ id: "decision-1", text: "Keep the durable seam." }],
    nextActions: [],
    sourceRefs: [],
    artifactRefs: [],
  };
}

describe("Room result.publish command", () => {
  it("strictly bounds and filters scratch submissions", () => {
    const profile = {
      workKind: "conversation" as const,
      environmentTemplate: "isolated-scratch" as const,
      repositorySnapshotId: null,
      objectFormat: null,
      baseRevision: null,
      generatedBranch: null,
    };
    expect(
      parseWorkResultSubmission(
        submission("conversation", "Bounded result."),
        profile,
      ),
    ).toMatchObject({ kind: "conversation", summary: "Bounded result." });
    expect(() =>
      parseWorkResultSubmission(
        { ...submission("conversation", "Unknown."), unexpected: true },
        profile,
      ),
    ).toThrow(TypeError);
    expect(() =>
      parseWorkResultSubmission(
        {
          ...submission("conversation", "Private."),
          sourceRefs: [{ kind: "task", taskId: randomUUID(), threadId: "thr_private" }],
        },
        profile,
      ),
    ).toThrow(TypeError);
    expect(() =>
      parseWorkResultSubmission(
        {
          ...submission("conversation", "Repository."),
          sourceRefs: [
            {
              kind: "repository_object",
              repositorySnapshotId: randomUUID(),
              objectFormat: "sha1",
              revision: "a".repeat(40),
            },
          ],
        },
        profile,
      ),
    ).toThrow(TypeError);
    expect(() =>
      parseWorkResultSubmission(
        {
          ...submission("conversation", "Too many decisions."),
          decisions: Array.from({ length: 51 }, (_, index) => ({
            id: `decision-${index}`,
            text: "Bounded.",
          })),
        },
        profile,
      ),
    ).toThrow(TypeError);
    expect(() =>
      parseWorkResultSubmission(
        {
          ...submission("conversation", "Oversized."),
          sourceRefs: Array.from({ length: 100 }, (_, index) => ({
            kind: "external_url",
            url: `https://example.com/${index}/${"x".repeat(1_500)}`,
          })),
        },
        profile,
      ),
    ).toThrow(TypeError);
  });

  it("publishes from Primary with durable replay, conflict, and monotonic revisions", async () => {
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
      const scratchTarget = target(harness, 601);
      const provisioned = await createWorkTogetherRoomResourceProvisioner(
        harness.deps,
        {
          resolveHost: () => scratchTarget,
          resolve: () => scratchTarget,
        },
      ).provision({ principal: ALICE, launch });
      const room = distribution(harness);
      const firstCommand = {
        kind: "result.publish",
        requestId: "creq_23456789ra",
        stream: PRIMARY_STREAM,
        submission: submission("conversation", "Primary result."),
      };

      const bootstrap = await room.bootstrap(contextFor(launch.bindingId));
      expect(bootstrap.capabilities).toContain("result.publish");

      const first = await room.execute(
        contextFor(launch.bindingId),
        firstCommand,
      );
      expect(first.status).toBe(202);
      expect(Object.keys(first.body).sort()).toEqual(
        [
          "admissionSequence",
          "commandKind",
          "completedAt",
          "createdAt",
          "outcome",
          "requestId",
          "result",
          "schemaVersion",
          "stream",
        ].sort(),
      );
      expect(first.body).toMatchObject({
        schemaVersion: 2,
        outcome: "accepted",
        requestId: firstCommand.requestId,
        commandKind: "result.publish",
        admissionSequence: 1,
        stream: PRIMARY_STREAM,
        result: {
          disposition: "result-published",
          resultRevision: 1,
          submission: firstCommand.submission,
        },
      });
      expect(first.body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
      expect(first.body.completedAt).toBe(first.body.createdAt);

      const replay = await room.execute(
        contextFor(launch.bindingId),
        firstCommand,
      );
      expect(replay).toEqual({
        status: 200,
        body: { ...first.body, outcome: "already-accepted" },
      });

      await expect(
        room.execute(contextFor(launch.bindingId), {
          ...firstCommand,
          submission: submission("conversation", "Changed result."),
        }),
      ).resolves.toMatchObject({
        status: 409,
        body: { outcome: "rejected", reason: "request_identity_conflict" },
      });

      const later = await room.execute(contextFor(launch.bindingId), {
        ...firstCommand,
        requestId: "creq_23456789rb",
        submission: submission("conversation", "Later result."),
      });
      expect(later).toMatchObject({
        status: 202,
        body: { result: { resultRevision: 2 } },
      });
      if (
        first.body.result === null ||
        typeof first.body.result !== "object" ||
        Array.isArray(first.body.result) ||
        later.body.result === null ||
        typeof later.body.result !== "object" ||
        Array.isArray(later.body.result)
      ) {
        throw new Error("result.publish receipt result must be an object");
      }
      expect(later.body.result.resultId).not.toBe(first.body.result.resultId);

      await expect(
        room.execute(contextFor(launch.bindingId), {
          ...firstCommand,
          requestId: "creq_23456789rc",
          stream: { kind: "subagent", id: randomUUID() },
        }),
      ).rejects.toMatchObject({ kind: "not_found" });
      expect(
        getThreadCommandAdmission(harness.db, {
          threadId: provisioned.primaryThreadId,
          requestId: "creq_23456789rc",
        }),
      ).toBeNull();
    });
  });

  it("enforces read-only and managed-worktree repository evidence profiles", async () => {
    await withTestHarness(async (harness) => {
      const readOnlySnapshotId = randomUUID();
      const readOnlyLaunch = {
        bindingId: randomUUID(),
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        cellId: randomUUID(),
        workKind: "research" as const,
        repositorySnapshotId: readOnlySnapshotId,
        repositoryBindingId: randomUUID(),
        repositoryBindingVersion: 1,
        providerRepositoryId: "601",
        objectFormat: "sha1" as const,
        baseRevision: "a".repeat(40),
        candidateHostId: randomUUID(),
        environmentTemplate: "detached-read-only" as const,
      };
      const readOnlyTarget = target(harness, 603);
      await createWorkTogetherRoomResourceProvisioner(harness.deps, {
        resolveHost: () => readOnlyTarget,
        resolve: () => readOnlyTarget,
      }).provision({ principal: ALICE, launch: readOnlyLaunch });
      const room = distribution(harness);
      const readOnlySubmission = {
        ...submission("research", "Read-only evidence."),
        sourceRefs: [
          {
            kind: "repository_object",
            repositorySnapshotId: readOnlySnapshotId,
            objectFormat: "sha1",
            revision: "a".repeat(40),
            path: "docs/report.md",
          },
        ],
      };
      await expect(
        room.execute(contextFor(readOnlyLaunch.bindingId), {
          kind: "result.publish",
          requestId: "creq_23456789rd",
          stream: PRIMARY_STREAM,
          submission: readOnlySubmission,
        }),
      ).resolves.toMatchObject({ status: 202 });
      await expect(
        room.execute(contextFor(readOnlyLaunch.bindingId), {
          kind: "result.publish",
          requestId: "creq_23456789re",
          stream: PRIMARY_STREAM,
          submission: {
            ...readOnlySubmission,
            sourceRefs: [
              { ...readOnlySubmission.sourceRefs[0], revision: "b".repeat(40) },
            ],
          },
        }),
      ).rejects.toMatchObject({ kind: "not_found" });

      const codeSnapshotId = randomUUID();
      const codeLaunch = {
        bindingId: randomUUID(),
        workspaceId: randomUUID(),
        taskId: randomUUID(),
        cellId: randomUUID(),
        workKind: "code" as const,
        repositorySnapshotId: codeSnapshotId,
        repositoryBindingId: randomUUID(),
        repositoryBindingVersion: 1,
        providerRepositoryId: "602",
        objectFormat: "sha1" as const,
        baseRevision: "c".repeat(40),
        baseBranch: "main",
        generatedBranch: "rooms/result-605",
        candidateHostId: randomUUID(),
        environmentTemplate: "managed-worktree" as const,
      };
      const codeTarget = target(harness, 605);
      await createWorkTogetherRoomResourceProvisioner(harness.deps, {
        resolveHost: () => codeTarget,
        resolve: () => codeTarget,
      }).provision({ principal: ALICE, launch: codeLaunch });
      await expect(
        room.execute(contextFor(codeLaunch.bindingId), {
          kind: "result.publish",
          requestId: "creq_23456789rf",
          stream: PRIMARY_STREAM,
          submission: {
            ...submission("code", "Managed result."),
            gitEvidence: {
              schemaVersion: 1,
              repositorySnapshotId: codeSnapshotId,
              objectFormat: "sha1",
              branch: {
                name: codeLaunch.generatedBranch,
                headRevision: "d".repeat(40),
              },
              commits: [{ revision: "d".repeat(40), title: "Ship result" }],
              changedFiles: [{ path: "src/result.ts", change: "added" }],
            },
          },
        }),
      ).resolves.toMatchObject({ status: 202 });
    });
  });
});
