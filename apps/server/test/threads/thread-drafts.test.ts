import { getThread, listQueuedThreadMessages } from "@bb/db";
import {
  sendMessageResponseSchema,
  threadResponseSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { waitForQueuedCommand } from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/thread-drafts-project";

function seedDraftFixture(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps, { id: "host-thread-drafts" });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: WORKSPACE_PATH,
  });
  seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: WORKSPACE_PATH,
  });
  return { host, project };
}

function text(value: string) {
  return { type: "text" as const, text: value, mentions: [] };
}

async function createDraftThread(
  harness: TestAppHarness,
  args: { hostId: string; projectId: string; text: string },
) {
  const response = await harness.app.request("/api/v1/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      origin: "app",
      projectId: args.projectId,
      providerId: "codex",
      model: "requested-model",
      reasoningLevel: "high",
      input: [text(args.text)],
      draft: true,
      environment: {
        type: "host",
        hostId: args.hostId,
        workspace: { type: "unmanaged", path: WORKSPACE_PATH },
      },
    }),
  });
  expect(response.status).toBe(201);
  return threadResponseSchema.parse(await readJson(response));
}

function putDraft(harness: TestAppHarness, threadId: string, input: unknown) {
  return harness.app.request(`/api/v1/threads/${threadId}/draft`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input }),
  });
}

describe("draft threads", () => {
  it("creates a pending thread that holds its draft without dispatching", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedDraftFixture(harness);

      const thread = await createDraftThread(harness, {
        hostId: host.id,
        projectId: project.id,
        text: "Plan the migration",
      });

      expect(thread.status).toBe("pending");
      expect(thread.draft).toEqual([text("Plan the migration")]);
      expect(thread.titleFallback).toBe("Plan the migration");
      expect(thread.queuedMessageCount).toBe(0);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
      const stored = getThread(harness.db, thread.id);
      expect(stored?.modelOverride).toBe("requested-model");
      expect(stored?.reasoningLevelOverride).toBe("high");
    });
  });

  it("rejects combining a draft with a scheduled send", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedDraftFixture(harness);
      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          input: [text("Later")],
          draft: true,
          sendAt: Date.now() + 60_000,
          environment: {
            type: "host",
            hostId: host.id,
            workspace: { type: "unmanaged", path: WORKSPACE_PATH },
          },
        }),
      });
      expect(response.status).toBe(400);
    });
  });

  it("replaces and clears the draft, keeping the fallback title current", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedDraftFixture(harness);
      const thread = await createDraftThread(harness, {
        hostId: host.id,
        projectId: project.id,
        text: "First idea",
      });

      const updated = await putDraft(harness, thread.id, [text("Second idea")]);
      expect(updated.status).toBe(200);
      const updatedThread = threadResponseSchema.parse(await readJson(updated));
      expect(updatedThread.draft).toEqual([text("Second idea")]);
      expect(updatedThread.titleFallback).toBe("Second idea");

      const cleared = await putDraft(harness, thread.id, []);
      const clearedThread = threadResponseSchema.parse(await readJson(cleared));
      expect(clearedThread.draft).toBeNull();
      expect(clearedThread.status).toBe("pending");
      expect(getThread(harness.db, thread.id)?.draft).toBeNull();
    });
  });

  it("starts the thread when a message is sent to it", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedDraftFixture(harness);
      const thread = await createDraftThread(harness, {
        hostId: host.id,
        projectId: project.id,
        text: "Ship it",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: [text("Ship it")], mode: "auto" }),
        },
      );

      expect(response.status).toBe(200);
      expect(
        sendMessageResponseSchema.parse(await readJson(response)).delivery,
      ).toBe("sent");
      expect(getThread(harness.db, thread.id)?.status).not.toBe("pending");
      await waitForQueuedCommand(
        harness,
        (queued) =>
          "threadId" in queued.command && queued.command.threadId === thread.id,
      );
    });
  });
});
