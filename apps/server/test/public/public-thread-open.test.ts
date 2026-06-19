import { getThread } from "@bb/db";
import { threadOpenResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

interface OpenRequestBody {
  source: "workspace" | "thread-storage";
  path: string;
  lineNumber: number | null;
}

async function postOpen(
  harness: TestAppHarness,
  threadId: string,
  body: OpenRequestBody,
): Promise<Response> {
  return harness.app.request(`/api/v1/threads/${threadId}/open`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("public thread open", () => {
  it("broadcasts an open-file signal to connected clients without persisting", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-open",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-open-source",
      });
      const thread = seedThread(harness.deps, { projectId: project.id });

      const socket = createMockHubSocket();
      harness.deps.hub.registerClient(socket);

      const before = getThread(harness.db, thread.id);

      const response = await postOpen(harness, thread.id, {
        source: "workspace",
        path: "src/index.ts",
        lineNumber: 42,
      });

      expect(response.status).toBe(200);
      const body = threadOpenResponseSchema.parse(await readJson(response));
      expect(body).toEqual({ delivered: 1 });

      expect(socket.messages).toHaveLength(1);
      expect(JSON.parse(socket.messages[0])).toEqual({
        type: "thread-open-file",
        threadId: thread.id,
        source: "workspace",
        path: "src/index.ts",
        lineNumber: 42,
      });

      // Ephemeral: the thread row is untouched.
      expect(getThread(harness.db, thread.id)).toEqual(before);
    });
  });

  it("rejects unsafe paths and sends nothing", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-open-bad",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-open-bad-source",
      });
      const thread = seedThread(harness.deps, { projectId: project.id });

      const socket = createMockHubSocket();
      harness.deps.hub.registerClient(socket);

      const response = await postOpen(harness, thread.id, {
        source: "workspace",
        path: "../escape.ts",
        lineNumber: null,
      });

      expect(response.status).toBe(400);
      expect(socket.messages).toHaveLength(0);
    });
  });

  it("returns 404 for an unknown thread", async () => {
    await withTestHarness(async (harness) => {
      const response = await postOpen(harness, "thr_missing", {
        source: "workspace",
        path: "src/index.ts",
        lineNumber: null,
      });

      expect(response.status).toBe(404);
    });
  });
});
