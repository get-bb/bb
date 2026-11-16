import { archiveThread } from "@bb/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as threadCommands from "../../src/services/threads/thread-commands.js";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const sessionId = "0958a8c8-9527-40ee-9358-ab17ed9e6f98";

afterEach(() => vi.restoreAllMocks());

describe("voice session controls", () => {
  for (const action of ["keepAlive", "stop"] as const) {
    it(`dispatches ${action} without resolving coding-turn setup`, async () => {
      await withTestHarness(async (harness) => {
        const { thread, environment } = seedThreadFixture(harness);
        const setup = vi
          .spyOn(threadCommands, "prepareTurnSubmitCommandPayload")
          .mockRejectedValue(new Error("Workspace instructions unavailable"));
        const response = harness.app.request(
          `/api/v1/threads/${thread.id}/voice`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, sessionId }),
          },
        );
        const queued = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "thread.voice",
        );
        expect(queued.command).toEqual({
          type: "thread.voice",
          threadId: thread.id,
          environmentId: environment.id,
          command: { action, sessionId },
        });
        await reportQueuedCommandSuccess(harness, queued, { sdp: null });
        expect((await response).status).toBe(200);
        expect(setup).not.toHaveBeenCalled();
      });
    });
  }

  it("uses user-initiated approval handling when preparing a voice runtime", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      vi.spyOn(threadCommands, "buildExecutionOptions").mockResolvedValue({
        model: "test-model",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "accept-edits",
        source: "client/turn/requested",
      });
      const setup = vi
        .spyOn(threadCommands, "prepareTurnSubmitCommandPayload")
        .mockRejectedValue(new Error("Preparation interrupted for inspection"));
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/voice`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "start", sessionId, sdp: "offer" }),
        },
      );
      expect(response.status).toBe(500);
      expect(setup).toHaveBeenCalledWith(
        harness.deps,
        expect.objectContaining({
          permissionEscalation: "ask",
          execution: expect.objectContaining({
            permissionMode: "accept-edits",
          }),
        }),
      );
    });
  });

  for (const state of ["archived", "stopping"] as const) {
    it(`allows hang-up while the thread is ${state}`, async () => {
      await withTestHarness(async (harness) => {
        const { thread } = seedThreadFixture(harness, {
          thread: { status: state === "stopping" ? "stopping" : "idle" },
        });
        if (state === "archived")
          archiveThread(harness.db, harness.hub, thread.id);
        const response = harness.app.request(
          `/api/v1/threads/${thread.id}/voice`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "stop", sessionId }),
          },
        );
        const queued = await waitForQueuedCommand(
          harness,
          ({ command }) => command.type === "thread.voice",
        );
        await reportQueuedCommandSuccess(harness, queued, { sdp: null });
        expect((await response).status).toBe(200);
      });
    });
  }
});
