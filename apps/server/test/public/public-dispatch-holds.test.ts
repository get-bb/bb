import { getThread, listDispatchHolds } from "@bb/db";
import {
  dispatchHoldListResponseSchema,
  dispatchHoldResponseSchema,
  threadResponseSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/public-dispatch-holds";

async function createHeldThread(harness: TestAppHarness, hostId: string) {
  const { host } = seedHostSession(harness.deps, { id: hostId });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: WORKSPACE_PATH,
  });
  seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: WORKSPACE_PATH,
  });
  return createThreadFromRequest(harness.deps, {
    environment: {
      type: "host",
      hostId: host.id,
      workspace: { type: "unmanaged", path: WORKSPACE_PATH },
    },
    holdUntil: Date.now() + 600_000,
    input: textInput("Send this at nine"),
    origin: "app",
    projectId: project.id,
    providerId: "codex",
    startedOnBehalfOf: null,
  });
}

describe("public dispatch hold routes", () => {
  it("lists a held thread's holds and surfaces the derived held status", async () => {
    await withTestHarness(async (harness) => {
      const thread = await createHeldThread(harness, "host-public-holds-list");

      const threadResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
      );
      expect(threadResponse.status).toBe(200);
      const threadBody = threadResponseSchema.parse(
        await readJson(threadResponse),
      );
      expect(threadBody.status).toBe("idle");
      expect(threadBody.runtime.displayStatus).toBe("held");
      expect(threadBody.liveDispatchHoldCount).toBe(1);

      const threadHolds = await harness.app.request(
        `/api/v1/threads/${thread.id}/holds`,
      );
      expect(threadHolds.status).toBe(200);
      const holds = dispatchHoldListResponseSchema.parse(
        await readJson(threadHolds),
      );
      expect(holds).toHaveLength(1);
      expect(holds[0]?.holder).toBe("user");
      expect(holds[0]?.reason).toBe("Scheduled");
      expect(holds[0]?.payload).toMatchObject({
        kind: "inline",
        editable: true,
      });

      const allHolds = await harness.app.request(
        `/api/v1/holds?threadId=${thread.id}`,
      );
      expect(allHolds.status).toBe(200);
      expect(
        dispatchHoldListResponseSchema.parse(await readJson(allHolds)),
      ).toHaveLength(1);
    });
  });

  it("edits a live hold's draft and timer, then cancels it", async () => {
    await withTestHarness(async (harness) => {
      const thread = await createHeldThread(harness, "host-public-holds-edit");
      const holdId = listDispatchHolds(harness.db, {
        threadId: thread.id,
        liveOnly: true,
      })[0]!.id;
      const resumeAt = Date.now() + 900_000;

      const patched = await harness.app.request(`/api/v1/holds/${holdId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: textInput("Send this at ten instead"),
          resumeAt,
        }),
      });
      expect(patched.status).toBe(200);
      const updated = dispatchHoldResponseSchema.parse(
        await readJson(patched),
      );
      expect(updated.resumeAt).toBe(resumeAt);
      expect(updated.payload).toMatchObject({
        kind: "inline",
        input: textInput("Send this at ten instead"),
      });

      const cancelled = await harness.app.request(
        `/api/v1/holds/${holdId}/cancel`,
        { method: "POST" },
      );
      expect(cancelled.status).toBe(200);
      expect(
        dispatchHoldResponseSchema.parse(await readJson(cancelled)).releaseKind,
      ).toBe("cancelled");

      // Cancelling discards the dispatch, so the thread stays a never-started
      // shell rather than running the turn.
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      const afterCancel = await harness.app.request(
        `/api/v1/holds/${holdId}/cancel`,
        { method: "POST" },
      );
      expect(afterCancel.status).toBe(409);
    });
  });

  it("releases a held first turn through the route", async () => {
    await withTestHarness(async (harness) => {
      const thread = await createHeldThread(
        harness,
        "host-public-holds-release",
      );
      const holdId = listDispatchHolds(harness.db, {
        threadId: thread.id,
        liveOnly: true,
      })[0]!.id;

      const released = await harness.app.request(
        `/api/v1/holds/${holdId}/release`,
        { method: "POST" },
      );
      expect(released.status).toBe(200);
      expect(
        dispatchHoldResponseSchema.parse(await readJson(released)).releaseKind,
      ).toBe("user");
      expect(getThread(harness.db, thread.id)?.status).not.toBe("idle");

      const again = await harness.app.request(
        `/api/v1/holds/${holdId}/release`,
        { method: "POST" },
      );
      expect(again.status).toBe(409);
    });
  });
});
