import {
  activateThreadBranch,
  getActiveThreadBranch,
  listRewindRolloutMetrics,
  stageThreadBranch,
  threadBranches,
  threads,
} from "@bb/db";
import {
  threadRewindBranchHistoryResponseSchema,
  threadRewindRestoreResponseSchema,
} from "@bb/server-contract";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public thread rewind routes", () => {
  it("rejects rewind commits while the experiment is off and counts the denial", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-rewind-gate",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-rewind-gate-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "codex",
        status: "idle",
      });
      const activeBranch = getActiveThreadBranch(harness.db, thread.id);
      if (!activeBranch) throw new Error("Expected seeded active branch");

      const commit = await harness.app.request(
        `/api/v1/threads/${thread.id}/rewind`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            editedInput: [{ type: "text", text: "edited", mentions: [] }],
            idempotencyKey: "rewind-gate-1",
            target: {
              branchId: activeBranch.id,
              sourceSequence: 1,
              turnId: "turn-1",
            },
          }),
        },
      );
      expect(commit.status).toBe(403);
      expect(await readJson(commit)).toMatchObject({
        code: "experiment_disabled",
      });
      expect(listRewindRolloutMetrics(harness.db).experiment_denied).toBe(1);

      // Read-only surfaces stay available while the experiment is off, so
      // existing branch history is never hidden.
      const history = await harness.app.request(
        `/api/v1/threads/${thread.id}/rewind/branches`,
      );
      expect(history.status).toBe(200);
    });
  });

  it("returns branch history without provider session identifiers", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-rewind-history",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-rewind-history-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "codex",
        status: "idle",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/rewind/branches`,
      );
      expect(response.status).toBe(200);
      const history = threadRewindBranchHistoryResponseSchema.parse(
        await readJson(response),
      );
      expect(history.activeBranchId).toBeTruthy();
      expect(history.branches).toHaveLength(1);
      expect(history.branches[0]).toMatchObject({
        active: true,
        lifecycle: "active",
        threadId: thread.id,
      });
      expect(history.branches[0]).not.toHaveProperty("providerThreadId");
    });
  });

  it("restores the active branch idempotently and rejects a cross-thread branch", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-rewind-restore",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-rewind-restore-source",
      });
      const first = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "codex",
        status: "idle",
      });
      const second = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "codex",
        status: "idle",
      });
      const firstBranch = getActiveThreadBranch(harness.db, first.id);
      const secondBranch = getActiveThreadBranch(harness.db, second.id);
      if (!firstBranch || !secondBranch) {
        throw new Error("Expected seeded active branches");
      }

      const restore = await harness.app.request(
        `/api/v1/threads/${first.id}/rewind/restore`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            branchId: firstBranch.id,
            expectedActiveBranchId: firstBranch.id,
          }),
        },
      );
      expect(restore.status).toBe(200);
      expect(
        threadRewindRestoreResponseSchema.parse(await readJson(restore)),
      ).toEqual({
        activeBranchId: firstBranch.id,
        previousBranchId: firstBranch.id,
        threadId: first.id,
      });

      const crossThread = await harness.app.request(
        `/api/v1/threads/${first.id}/rewind/restore`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            branchId: secondBranch.id,
            expectedActiveBranchId: firstBranch.id,
          }),
        },
      );
      expect(crossThread.status).toBe(404);

      const eventCount = harness.db
        .select({ id: threadBranches.id })
        .from(threadBranches)
        .where(eq(threadBranches.threadId, first.id))
        .all().length;
      expect(eventCount).toBe(1);
      expect(
        harness.db
          .select({ status: threads.status })
          .from(threads)
          .where(eq(threads.id, first.id))
          .get()?.status,
      ).toBe("idle");
    });
  });

  it("rejects malformed preview query values before touching rewind state", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-rewind-preview-validation",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-rewind-preview-validation-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "codex",
        status: "idle",
      });
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/rewind/preview?branchId=br_missing&sourceSequence=not-a-number&turnId=turn_1`,
      );
      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("keeps branch history projection gapless with exactly one active branch across restore cycles", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-rewind-projection",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-rewind-projection-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "codex",
        status: "idle",
      });
      const root = getActiveThreadBranch(harness.db, thread.id);
      if (!root) throw new Error("Expected seeded active branch");

      const first = stageThreadBranch(harness.db, {
        cutoffSequence: 1,
        creationReason: "rewind",
        parentBranchId: root.id,
        providerId: "codex",
        providerThreadId: "provider-projection-1",
        threadId: thread.id,
      });
      activateThreadBranch(harness.db, { branchId: first.id });
      const second = stageThreadBranch(harness.db, {
        cutoffSequence: 1,
        creationReason: "rewind",
        parentBranchId: first.id,
        providerId: "codex",
        providerThreadId: "provider-projection-2",
        threadId: thread.id,
      });
      activateThreadBranch(harness.db, { branchId: second.id });

      const restoreRoot = await harness.app.request(
        `/api/v1/threads/${thread.id}/rewind/restore`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            branchId: root.id,
            expectedActiveBranchId: second.id,
          }),
        },
      );
      expect(restoreRoot.status).toBe(200);

      const historyResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/rewind/branches`,
      );
      expect(historyResponse.status).toBe(200);
      const history = threadRewindBranchHistoryResponseSchema.parse(
        await readJson(historyResponse),
      );
      expect(history.activeBranchId).toBe(root.id);
      expect(history.branches.map((branch) => branch.id).sort()).toEqual(
        [root.id, first.id, second.id].sort(),
      );
      expect(new Set(history.branches.map((branch) => branch.id)).size).toBe(
        history.branches.length,
      );
      expect(history.branches.filter((branch) => branch.active)).toHaveLength(
        1,
      );
      expect(
        history.branches.every((branch) => !("providerThreadId" in branch)),
      ).toBe(true);
    });
  });
});
