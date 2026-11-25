import { threadSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import { seedQueuedMessage, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import { moveThreadStatus } from "../helpers/thread-status.js";

async function settledWithin(
  response: Promise<Response> | Response,
  ms: number,
): Promise<boolean> {
  return Promise.race([
    Promise.resolve(response).then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

describe("GET /threads/:id/status/wait", () => {
  it("returns the thread at once when its status is already not notStatus", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "idle" },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/status/wait?notStatus=active&waitMs=60000`,
      );

      expect(response.status).toBe(200);
      const body = threadSchema.parse(await readJson(response));
      expect(body).toMatchObject({ id: thread.id, status: "idle" });
    });
  });

  it("returns the thread when its status changes after the request starts", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });

      const pending = harness.app.request(
        `/api/v1/threads/${thread.id}/status/wait?notStatus=active&waitMs=60000`,
      );
      harness.hub.notifyThread(thread.id, ["events-appended"]);
      expect(await settledWithin(pending, 50)).toBe(false);

      moveThreadStatus(harness.deps, {
        move: "run.succeeded",
        threadId: thread.id,
      });

      const response = await pending;
      expect(response.status).toBe(200);
      const body = threadSchema.parse(await readJson(response));
      expect(body.status).toBe("idle");
    });
  });

  it("returns the thread when its queued messages change", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "error" },
      });

      const pending = harness.app.request(
        `/api/v1/threads/${thread.id}/status/wait?notStatus=error&waitMs=60000`,
      );
      expect(await settledWithin(pending, 50)).toBe(false);

      seedQueuedMessage(harness.deps, {
        content: textInput("Follow up"),
        threadId: thread.id,
      });

      const response = await pending;
      expect(response.status).toBe(200);
      const body = threadSchema.parse(await readJson(response));
      expect(body.status).toBe("error");
    });
  });

  it("returns 204 when the deadline passes with the status unchanged", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/status/wait?notStatus=active&waitMs=50`,
      );

      expect(response.status).toBe(204);
    });
  });

  it("returns 404 thread_not_found for a missing thread", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        `/api/v1/threads/missing-thread/status/wait?notStatus=active&waitMs=50`,
      );

      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "thread_not_found",
      });
    });
  });
});
