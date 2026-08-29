import { eq } from "drizzle-orm";
import { threads } from "@bb/db";
import { turnScope } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { readJson } from "../helpers/json.js";
import { seedEvent, seedThreadFixture } from "../helpers/seed.js";
import { startTestServer, withTestHarness } from "../helpers/test-app.js";

describe("public thread wait route", () => {
  it("returns the matching status and preserves thread_not_found", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "idle" },
      });
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/wait?status=idle&waitMs=0`,
      );
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        id: thread.id,
        status: "idle",
      });

      const missing = await harness.app.request(
        "/api/v1/threads/missing-thread/wait?status=idle&waitMs=0",
      );
      expect(missing.status).toBe(404);
      await expect(readJson(missing)).resolves.toMatchObject({
        code: "thread_not_found",
      });
    });
  });

  it("returns an error thread when idle is unreachable", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "error" },
      });
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/wait?status=idle&waitMs=1000`,
      );
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        id: thread.id,
        status: "error",
      });
      expect(harness.threadWaitCoordinator.getStats()).toMatchObject({
        activeCallers: 0,
        activeEntries: 0,
        unreachableCount: 1,
      });
    });
  });

  it("shares one status check across 100 route callers", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      const requests = Array.from({ length: 100 }, () =>
        harness.app.request(
          `/api/v1/threads/${thread.id}/wait?status=idle&waitMs=10000`,
        ),
      );
      await vi.waitFor(() => {
        expect(harness.threadWaitCoordinator.getStats()).toMatchObject({
          activeCallers: 100,
          activeEntries: 1,
          checkCount: 1,
        });
      });

      harness.db
        .update(threads)
        .set({ status: "idle", updatedAt: Date.now() })
        .where(eq(threads.id, thread.id))
        .run();
      harness.hub.notifyThread(thread.id, ["status-changed"]);

      const responses = await Promise.all(requests);
      expect(responses.every((response) => response.status === 200)).toBe(true);
      expect(harness.threadWaitCoordinator.getStats()).toMatchObject({
        activeCallers: 0,
        activeEntries: 0,
        checkCount: 2,
      });
    });
  });

  it("normalizes absent and zero event cursors into one entry", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const requests = Array.from({ length: 100 }, (_, index) =>
        harness.app.request(
          `/api/v1/threads/${thread.id}/events/wait?type=item/completed&waitMs=10000${index % 2 === 0 ? "" : "&afterSeq=0"}`,
        ),
      );
      await vi.waitFor(() => {
        expect(harness.threadWaitCoordinator.getStats()).toMatchObject({
          activeCallers: 100,
          activeEntries: 1,
          checkCount: 1,
        });
      });

      seedEvent(harness.deps, {
        data: {
          item: { id: "msg-1", text: "Reply", type: "agentMessage" },
        },
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: 1,
        threadId: thread.id,
        type: "item/completed",
      });

      const responses = await Promise.all(requests);
      expect(responses.every((response) => response.status === 200)).toBe(true);
      expect(harness.threadWaitCoordinator.getStats()).toMatchObject({
        activeCallers: 0,
        activeEntries: 0,
        checkCount: 2,
      });
    });
  });

  it("removes a disconnected route caller", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      const controller = new AbortController();
      const request = harness.app.request(
        `/api/v1/threads/${thread.id}/wait?status=idle&waitMs=10000`,
        { signal: controller.signal },
      );
      await vi.waitFor(() => {
        expect(harness.threadWaitCoordinator.getStats().activeCallers).toBe(1);
      });
      controller.abort();
      await request;
      expect(harness.threadWaitCoordinator.getStats()).toMatchObject({
        activeCallers: 0,
        activeEntries: 0,
      });
    });
  });

  it("returns 429 when unique wait entries reach the server limit", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const controllers = Array.from(
        { length: 200 },
        () => new AbortController(),
      );
      const requests = controllers.map((controller, index) =>
        harness.app.request(
          `/api/v1/threads/${thread.id}/events/wait?type=turn/completed&afterSeq=${index + 1}&waitMs=10000`,
          { signal: controller.signal },
        ),
      );
      await vi.waitFor(() => {
        expect(harness.threadWaitCoordinator.getStats().activeEntries).toBe(
          200,
        );
      });

      const rejected = await harness.app.request(
        `/api/v1/threads/${thread.id}/events/wait?type=turn/completed&afterSeq=201&waitMs=10000`,
      );
      expect(rejected.status).toBe(429);
      await expect(readJson(rejected)).resolves.toMatchObject({
        code: "too_many_waiters",
        retryable: true,
      });

      for (const controller of controllers) controller.abort();
      await Promise.all(requests);
      expect(harness.threadWaitCoordinator.getStats()).toMatchObject({
        activeCallers: 0,
        activeEntries: 0,
        limitRejectionCount: 1,
      });
    });
  });

  it("returns 204 and clears waits during server shutdown", async () => {
    const server = await startTestServer();
    let closed = false;
    try {
      const { thread } = seedThreadFixture(server, {
        thread: { status: "active" },
      });
      const responsePromise = fetch(
        `${server.baseUrl}/api/v1/threads/${thread.id}/wait?status=idle&waitMs=60000`,
      );
      await vi.waitFor(() => {
        expect(server.threadWaitCoordinator.getStats().activeCallers).toBe(1);
      });
      await server.close();
      closed = true;
      const response = await responsePromise;
      expect(response.status).toBe(204);
      expect(server.threadWaitCoordinator.getStats()).toMatchObject({
        activeCallers: 0,
        activeEntries: 0,
      });
    } finally {
      if (!closed) await server.close();
    }
  });
});
